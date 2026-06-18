export default {
  pkg: {
    scripts: [
      "node_modules/sqlite3/lib/**/*.js",
      "node_modules/bindings/**/*.js",
      "node_modules/file-uri-to-path/**/*.js"
    ],
    assets: [
      "package.json",
      "node_modules/sqlite3/package.json",
      "node_modules/sqlite3/build/Release/node_sqlite3.node",
      "node_modules/bindings/package.json",
      "node_modules/file-uri-to-path/package.json"
    ]
  }
};
