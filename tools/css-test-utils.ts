import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDirectory, "..");

export function readProjectFile(path: string) {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

function readCssGraph(path: string, visited: Set<string>): string {
  const absolutePath = resolve(projectRoot, path);

  if (visited.has(absolutePath)) {
    throw new Error(`Circular CSS import detected at ${path}`);
  }

  visited.add(absolutePath);
  const source = readFileSync(absolutePath, "utf8");
  const imports = [...source.matchAll(/@import\s+["']([^"']+\.css)["']\s*;/g)];
  const importedCss = imports
    .map(([, importedPath]) => {
      const resolvedImport = resolve(dirname(absolutePath), importedPath);
      const projectRelativePath = resolvedImport.slice(projectRoot.length + 1);
      return readCssGraph(projectRelativePath, visited);
    })
    .join("\n");

  return `${importedCss}\n${source.replace(/@import\s+["'][^"']+\.css["']\s*;/g, "")}`;
}

export function readApplicationCss() {
  return readCssGraph("src/index.css", new Set());
}
