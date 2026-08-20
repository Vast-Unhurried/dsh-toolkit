/**
 * dsh-softui-skin build script (zero dependencies, plain Node).
 *
 * Reads themes/softui-light.json + themes/softui-dark.json and
 * src/client.tpl.js, merges the two palettes into one per-mode override
 * table (`{ token: { light, dark } }`) at the __OVERRIDES_JSON__
 * placeholder, and writes lib/client.js. Also copies the host half
 * src/index.js → lib/index.js.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const themeFiles = ['softui-light.json', 'softui-dark.json']
const themes = themeFiles.map((file) => {
  const theme = JSON.parse(readFileSync(join(root, 'themes', file), 'utf8'))
  const required = ['id', 'name', 'colorScheme', 'tokens']
  for (const key of required) {
    if (!(key in theme)) throw new Error('themes/' + file + ': missing ' + key)
  }
  if (theme.colorScheme !== 'light' && theme.colorScheme !== 'dark') {
    throw new Error('themes/' + file + ': colorScheme must be light or dark')
  }
  const colorRe = /^(#([0-9a-fA-F]{3,8})|rgba?\([^)]*\)|transparent)$/
  for (const [name, value] of Object.entries(theme.tokens)) {
    if (typeof value !== 'string' || !colorRe.test(value.trim())) {
      throw new Error('themes/' + file + ': token ' + name + ' is not a valid CSS color: ' + value)
    }
  }
  return theme
})

const light = themes.find((theme) => theme.colorScheme === 'light')
const dark = themes.find((theme) => theme.colorScheme === 'dark')
if (light === undefined || dark === undefined) {
  throw new Error('themes/: need one light and one dark palette')
}

/** Merge both palettes into `token → { light, dark }` pairs. */
const overrides = {}
for (const name of new Set([...Object.keys(light.tokens), ...Object.keys(dark.tokens)])) {
  overrides[name] = {
    light: light.tokens[name] ?? dark.tokens[name],
    dark: dark.tokens[name] ?? light.tokens[name]
  }
}

const template = readFileSync(join(root, 'src', 'client.tpl.js'), 'utf8')
if (!template.includes('__OVERRIDES_JSON__')) {
  throw new Error('src/client.tpl.js is missing the __OVERRIDES_JSON__ placeholder')
}
const client = template.replace('__OVERRIDES_JSON__', JSON.stringify(overrides, null, 2))

mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib', 'client.js'), client)
copyFileSync(join(root, 'src', 'index.js'), join(root, 'lib', 'index.js'))

console.log('built lib/client.js (' + Object.keys(overrides).length + ' tokens, light+dark merged) and lib/index.js')
