// Lets a test read a file's text with `import text from './file?raw'`, which
// the build tool provides. The default export is that tool's convention.
declare module '*?raw' {
  const text: string;
  export default text;
}
