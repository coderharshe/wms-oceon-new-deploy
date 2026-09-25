import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Thin wrapper over the FILES R2 binding (product images, generated
 * invoice/EOD documents, backup exports). No abstraction beyond what's
 * actually called — R2Bucket's own API is already minimal.
 */
function bucket(): R2Bucket {
  const env = getCloudflareContext().env;
  if (!env.FILES) throw new Error("R2 FILES binding not configured");
  return env.FILES;
}

export async function putFile(key: string, data: ArrayBuffer | string, contentType: string) {
  await bucket().put(key, data, { httpMetadata: { contentType } });
  return key;
}

export async function getFile(key: string) {
  return bucket().get(key);
}

export async function deleteFile(key: string) {
  await bucket().delete(key);
}

export async function listFiles(prefix: string) {
  const { objects } = await bucket().list({ prefix });
  return objects;
}
