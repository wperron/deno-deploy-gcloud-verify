// Deno server to list GCS buckets in the authenticated GCP project

import { Storage } from "npm:@google-cloud/storage";

// Function to get GCS buckets
async function listBuckets() {
  try {
    const storage = new Storage();
    const [buckets] = await storage.getBuckets();

    console.log(`Successfully retrieved ${buckets.length || 0} buckets`);
    return buckets || [];
  } catch (error) {
    console.error("Error listing buckets:", error);
    throw error;
  }
}

// Create a server that handles requests
Deno.serve(async (req) => {
  try {
    if (req.method === "GET") {
      // API endpoint for buckets
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
