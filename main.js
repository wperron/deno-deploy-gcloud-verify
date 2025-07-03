// Deno server to list GCS buckets in the authenticated GCP project

// Function to get the current Google Cloud project ID
async function getCurrentProject() {
  // First check if project ID is set in environment variables
  try {
    const hasEnvPermission = await Deno.permissions.query({ name: "env", variable: "GCP_PROJECT_ID" });
    if (hasEnvPermission.state === "granted") {
      const projectId = Deno.env.get("GCP_PROJECT_ID");
      if (projectId) {
        console.log(`Using project ID from environment: ${projectId}`);
        return projectId;
      }
    }
  } catch (_e) {
    // Ignore errors when checking environment variables
  }

  // Check if using a service account with project_id in the credentials
  try {
    const hasEnvPermission = await Deno.permissions.query({ name: "env", variable: "GCP_SERVICE_ACCOUNT" });
    if (hasEnvPermission.state === "granted") {
      const serviceAccountJson = Deno.env.get("GCP_SERVICE_ACCOUNT");
      if (serviceAccountJson) {
        const credentials = JSON.parse(serviceAccountJson);
        if (credentials.project_id) {
          console.log(`Using project ID from service account: ${credentials.project_id}`);
          return credentials.project_id;
        }
      }
    }
  } catch (_e) {
    // Ignore errors when checking environment variables
  }

  // Check if GOOGLE_APPLICATION_CREDENTIALS environment variable is set
  try {
    const hasEnvPermission = await Deno.permissions.query({ name: "env", variable: "GOOGLE_APPLICATION_CREDENTIALS" });
    if (hasEnvPermission.state === "granted") {
      const credentialsPath = Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS");
      if (credentialsPath) {
        try {
          const hasReadPermission = await Deno.permissions.query({ name: "read", path: credentialsPath });
          if (hasReadPermission.state === "granted") {
            const serviceAccountText = await Deno.readTextFile(credentialsPath);
            const credentials = JSON.parse(serviceAccountText);
            if (credentials.project_id) {
              console.log(`Using project ID from GOOGLE_APPLICATION_CREDENTIALS: ${credentials.project_id}`);
              return credentials.project_id;
            }
          }
        } catch (error) {
          console.error(`Error reading project ID from credentials file:`, error);
        }
      }
    }
  } catch (_e) {
    // Ignore errors when checking environment variables
  }

  // Try to read service account key file for project ID
  try {
    const hasReadPermission = await Deno.permissions.query({ name: "read", path: "./service-account.json" });
    if (hasReadPermission.state === "granted") {
      try {
        const serviceAccountText = await Deno.readTextFile("./service-account.json");
        const credentials = JSON.parse(serviceAccountText);
        if (credentials.project_id) {
          console.log(`Using project ID from service account file: ${credentials.project_id}`);
          return credentials.project_id;
        }
      } catch (_fileError) {
        // Ignore if file doesn't exist
      }
    }
  } catch (_e) {
    // Ignore errors when checking file permissions
  }

  // Fallback to using gcloud
  try {
    console.log("Getting current GCP project from gcloud...");
    const cmd = new Deno.Command("gcloud", {
      args: ["config", "get-value", "project"],
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout, stderr, success } = await cmd.output();

    if (!success) {
      const errorOutput = new TextDecoder().decode(stderr);
      console.error("Failed to get current project:", errorOutput);
      throw new Error("Could not determine current GCP project");
    }

    const projectId = new TextDecoder().decode(stdout).trim();
    if (!projectId) {
      throw new Error("No project is set in gcloud configuration");
    }

    console.log(`Current GCP project from gcloud: ${projectId}`);
    return projectId;
  } catch (error) {
    console.error("Error getting project:", error);
    throw error;
  }
}

// Function to get GCS buckets
async function listBuckets() {
  try {
    // Get credentials from Deno Deploy's secure environment variables or use Application Default Credentials
    const token = await getAccessToken();
    const projectId = await getCurrentProject();

    console.log(`Fetching GCS buckets for project ${projectId}...`);
    // Call the GCS API to list buckets
    const response = await fetch(`https://storage.googleapis.com/storage/v1/b?project=${projectId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`GCS API error (${response.status}):`, errorData);

      if (response.status === 401) {
        throw new Error("Authentication failed. Please ensure you're properly authenticated with Google Cloud.");
      } else if (response.status === 403) {
        throw new Error("Permission denied. Your account may not have sufficient permissions to list GCS buckets.");
      } else {
        throw new Error(`Failed to list buckets: ${response.status} ${errorData}`);
      }
    }

    const data = await response.json();
    console.log(`Successfully retrieved ${data.items?.length || 0} buckets`);
    return data.items || [];
  } catch (error) {
    console.error("Error listing buckets:", error);
    throw error;
  }
}

// Function to get access token
async function getAccessToken() {
  // First, check if service account credentials are provided as environment variables
  try {
    const hasEnvPermission = await Deno.permissions.query({ name: "env", variable: "GCP_SERVICE_ACCOUNT" });
    if (hasEnvPermission.state === "granted") {
      const serviceAccountJson = Deno.env.get("GCP_SERVICE_ACCOUNT");
      if (serviceAccountJson) {
        console.log("Using service account from GCP_SERVICE_ACCOUNT environment variable");
        const credentials = JSON.parse(serviceAccountJson);
        return await getServiceAccountToken(credentials);
      }
    }
  } catch (_e) {
    // Ignore errors when checking environment variables
  }

  // Check if GOOGLE_APPLICATION_CREDENTIALS environment variable is set
  try {
    const hasEnvPermission = await Deno.permissions.query({ name: "env", variable: "GOOGLE_APPLICATION_CREDENTIALS" });
    if (hasEnvPermission.state === "granted") {
      const credentialsPath = Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS");
      if (credentialsPath) {
        console.log(`Using service account from GOOGLE_APPLICATION_CREDENTIALS: ${credentialsPath}`);
        try {
          const hasReadPermission = await Deno.permissions.query({ name: "read", path: credentialsPath });
          if (hasReadPermission.state === "granted") {
            const serviceAccountText = await Deno.readTextFile(credentialsPath);
            const credentials = JSON.parse(serviceAccountText);
            return await getServiceAccountToken(credentials);
          }
        } catch (error) {
          console.error(`Error reading credentials file at ${credentialsPath}:`, error);
        }
      }
    }
  } catch (_e) {
    // Ignore errors when checking environment variables
  }

  // Next, check if we're running on Deno Deploy with CLOUD_ACCESS_TOKEN
  try {
    const hasEnvPermission = await Deno.permissions.query({ name: "env", variable: "CLOUD_ACCESS_TOKEN" });
    if (hasEnvPermission.state === "granted") {
      const token = Deno.env.get("CLOUD_ACCESS_TOKEN");
      if (token) {
        console.log("Using Deno Deploy's CLOUD_ACCESS_TOKEN");
        return token;
      }
    }
  } catch (_e) {
    // Ignore errors when checking environment variables
  }

  // Try to read service account key file from the filesystem
  try {
    const hasReadPermission = await Deno.permissions.query({ name: "read", path: "./service-account.json" });
    if (hasReadPermission.state === "granted") {
      try {
        console.log("Attempting to use service account key file...");
        const serviceAccountText = await Deno.readTextFile("./service-account.json");
        const credentials = JSON.parse(serviceAccountText);
        return await getServiceAccountToken(credentials);
      } catch (_fileError) {
        console.log("No service account key file found");
      }
    }
  } catch (_e) {
    // Ignore errors when checking file permissions
  }

  // Lastly, try to use Google Cloud CLI
  try {
    console.log("Attempting to use gcloud CLI for authentication...");
    const cmd = new Deno.Command("gcloud", {
      args: ["auth", "application-default", "print-access-token"],
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout, stderr, success } = await cmd.output();

    if (!success) {
      const errorOutput = new TextDecoder().decode(stderr);
      console.error("gcloud command failed:", errorOutput);
      throw new Error("Failed to get token from gcloud CLI");
    }

    const token = new TextDecoder().decode(stdout).trim();
    if (token) {
      console.log("Successfully obtained token from gcloud CLI");
      return token;
    }
  } catch (error) {
    console.error("Error using gcloud CLI:", error);
  }

  throw new Error("No authentication method available. Please set up a service account or ensure you're authenticated with 'gcloud auth login' and 'gcloud auth application-default login'");
}

// Function to get an access token from a service account
async function getServiceAccountToken(serviceAccountKey) {
  console.log(`Getting service account token for ${serviceAccountKey.client_email}...`);

  // Create a JWT for Google's OAuth2 token endpoint
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: serviceAccountKey.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  // Encode header and claim set
  const base64Header = btoa(JSON.stringify(header));
  const base64ClaimSet = btoa(JSON.stringify(claimSet));

  // Create signature base string
  const signatureBaseString = `${base64Header}.${base64ClaimSet}`;

  // Create a signed JWT
  const textEncoder = new TextEncoder();
  const privateKey = serviceAccountKey.private_key;

  // Import the private key
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContents = privateKey.substring(
    privateKey.indexOf(pemHeader) + pemHeader.length,
    privateKey.indexOf(pemFooter)
  ).replace(/\s/g, "");

  const binaryDer = base64ToBinary(pemContents);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // Sign the JWT
  const signatureUint8 = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    textEncoder.encode(signatureBaseString)
  );

  // Convert the signature to base64
  const signature = btoa(
    String.fromCharCode(...new Uint8Array(signatureUint8))
  ).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  // Final JWT
  const jwt = `${signatureBaseString}.${signature}`;

  // Exchange the JWT for an access token
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Failed to get access token: ${tokenResponse.status} ${errorText}`);
  }

  const tokenData = await tokenResponse.json();
  console.log("Successfully obtained service account token");
  return tokenData.access_token;
}

// Helper function to convert base64 to binary
function base64ToBinary(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Create a server that handles requests
Deno.serve(async (req) => {
  const url = new URL(req.url);

  try {
    if (req.method === "GET") {
      // Return HTML for the root path
      if (url.pathname === "/") {
        return new Response(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>GCS Bucket Lister</title>
              <style>
                body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
                h1 { color: #1a73e8; }
                .button { display: inline-block; background: #1a73e8; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; }
                .info { background: #e8f0fe; padding: 15px; border-radius: 4px; margin: 20px 0; }
                code { background: #f1f3f4; padding: 2px 5px; border-radius: 3px; font-family: monospace; }
              </style>
            </head>
            <body>
              <h1>GCS Bucket Lister</h1>
              <p>This Deno server lists Google Cloud Storage buckets in your authenticated GCP project.</p>

              <div class="info">
                <h3>Authentication</h3>
                <p>This application can use different authentication methods:</p>

                <h4>Service Account (Recommended for Production)</h4>
                <p>To use a service account:</p>
                <ol>
                  <li>Create a service account in your GCP project with appropriate permissions</li>
                  <li>Generate and download a JSON key file</li>
                  <li>Either:
                    <ul>
                      <li>Save the file as <code>service-account.json</code> in the application directory, or</li>
                      <li>Set the path to your key file using <code>GOOGLE_APPLICATION_CREDENTIALS</code> environment variable, or</li>
                      <li>Set the contents of the key file as the <code>GCP_SERVICE_ACCOUNT</code> environment variable</li>
                    </ul>
                  </li>
                  <li>Optionally set <code>GCP_PROJECT_ID</code> environment variable (if not included in the service account)</li>
                </ol>

                <h4>Local Development (gcloud CLI)</h4>
                <p>For local development:</p>
                <ol>
                  <li>Install the <a href="https://cloud.google.com/sdk/docs/install" target="_blank">Google Cloud SDK</a></li>
                  <li>Run <code>gcloud auth login</code> to authenticate your account</li>
                  <li>Run <code>gcloud auth application-default login</code> to set up application default credentials</li>
                  <li>Set your project with <code>gcloud config set project YOUR_PROJECT_ID</code></li>
                </ol>

                <h4>Deno Deploy</h4>
                <p>When running on Deno Deploy, the service will automatically use the built-in authentication.</p>
              </div>

              <p>
                <a href="/api/buckets" class="button">View GCS Buckets</a>
              </p>
            </body>
          </html>
        `, {
          headers: { "Content-Type": "text/html" },
        });
      }

      // API endpoint for buckets
      if (url.pathname === "/api/buckets") {
        const buckets = await listBuckets();

        return new Response(JSON.stringify({
          message: "GCS Buckets in the authenticated project",
          count: buckets.length,
          buckets: buckets.map(bucket => ({
            name: bucket.name,
            location: bucket.location,
            created: bucket.timeCreated,
            storageClass: bucket.storageClass,
            id: bucket.id
          })),
        }, null, 2), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      return new Response("Not Found", { status: 404 });
    } else {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
  } catch (error) {
    console.error("Server error:", error);

    return new Response(JSON.stringify({
      error: "Failed to retrieve GCS buckets",
      details: error.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}, { port: 8000 });

console.log("Server running on http://localhost:8000");
