// Deno server to list GCS buckets in the authenticated GCP project

// Function to get the current Google Cloud project ID
async function getCurrentProject() {
  try {
    console.log("Getting current GCP project...");
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

    console.log(`Current GCP project: ${projectId}`);
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
  // When running on Deno Deploy, we'll use the built-in service account
  // For local development, we'll use Application Default Credentials

  // First, check if we're running on Deno Deploy with CLOUD_ACCESS_TOKEN
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

  // Next, try to use Google Cloud CLI
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

  throw new Error("No authentication method available. Please make sure you're authenticated with 'gcloud auth login' and 'gcloud auth application-default login'");
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
                <p>To use this application, make sure you're authenticated with Google Cloud:</p>
                <ol>
                  <li>Install the <a href="https://cloud.google.com/sdk/docs/install" target="_blank">Google Cloud SDK</a></li>
                  <li>Run <code>gcloud auth login</code> to authenticate your account</li>
                  <li>Run <code>gcloud auth application-default login</code> to set up application default credentials</li>
                  <li>Set your project with <code>gcloud config set project YOUR_PROJECT_ID</code></li>
                </ol>
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
