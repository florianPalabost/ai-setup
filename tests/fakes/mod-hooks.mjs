// Module hooks: a mod's imports of herdr's runtime resolve to the fake in this folder.
const FAKES = {
  herdr: new URL("./herdr-module.mjs", import.meta.url).href,
  "gpui-kit": new URL("./gpui-module.mjs", import.meta.url).href,
  "gpui-base": new URL("./gpui-module.mjs", import.meta.url).href,
};

export async function resolve(specifier, context, next) {
  return FAKES[specifier] ? { url: FAKES[specifier], shortCircuit: true } : next(specifier, context);
}
