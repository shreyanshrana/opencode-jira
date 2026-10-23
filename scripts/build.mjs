import { mkdir, readdir, writeFile } from "node:fs/promises"
import { transformFileAsync } from "@babel/core"
import typescript from "@babel/preset-typescript"
import solid from "babel-preset-solid"

await mkdir(new URL("../dist/", import.meta.url), { recursive: true })
for (const file of await readdir(new URL("../src/", import.meta.url))) {
  if (!/\.tsx?$/.test(file)) continue
  const { code } = await transformFileAsync(new URL(`../src/${file}`, import.meta.url).pathname, {
    configFile: false,
    babelrc: false,
    presets: [
      ...(file.endsWith(".tsx") ? [[solid, { moduleName: "@opentui/solid", generate: "universal" }]] : []),
      typescript,
    ],
    plugins: [() => ({
      visitor: {
        ImportDeclaration(path) {
          path.node.source.value = path.node.source.value.replace(/\.tsx?$/, ".js")
        },
      },
    })],
  })
  await writeFile(new URL(`../dist/${file.replace(/\.tsx?$/, ".js")}`, import.meta.url), `${code}\n`)
}
