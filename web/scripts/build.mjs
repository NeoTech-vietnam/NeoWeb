// Vinext explicitly exits after exporting. On Windows, abrupt teardown can race
// native worker close callbacks (UV_HANDLE_CLOSING). Let successful builds drain
// the event loop normally; all nonzero exits keep their original behavior.
const exit = process.exit.bind(process);
let complete;
const exported = new Promise((resolve) => { complete = resolve; });
process.exit = (code) => {
  if (code === 0) {
    process.exitCode = 0;
    complete();
    return;
  }
  exit(code);
};
const cli = new URL('./cli.js', import.meta.resolve('vinext'));
process.argv = [process.argv[0], cli.pathname, 'build'];
await import(cli.href);
await exported;
await import('./normalize-export.mjs');
