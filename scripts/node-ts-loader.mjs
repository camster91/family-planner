// Resolve extensionless relative TypeScript imports for the small Node
// fixture/recovery scripts. The application is bundled by Next/OpenNext, but
// these runners load source .ts files directly with Node's type stripper;
// Node's ESM resolver deliberately does not add file extensions.
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context, nextResolve);
  } catch (error) {
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      throw error;
    }

    const parentPath = context.parentURL?.startsWith("file:")
      ? fileURLToPath(context.parentURL)
      : path.join(process.cwd(), "index.mjs");
    const basePath = specifier.startsWith("/")
      ? specifier
      : path.resolve(path.dirname(parentPath), specifier);

    for (const extension of SOURCE_EXTENSIONS) {
      const candidate = `${basePath}${extension}`;
      try {
        if ((await stat(candidate)).isFile()) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      } catch {
        // Try the next supported source extension.
      }
    }

    throw error;
  }
}
