// Preserve class names for structural unit assertions. Real layout and style
// acceptance belongs to the rendered browser checks, not jsdom.
module.exports = new Proxy(
  {},
  {
    get: (_target, name) => (name === "__esModule" ? false : String(name)),
  },
);
