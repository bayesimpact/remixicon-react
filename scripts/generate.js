const fs = require('fs');
const { sync: mkdirp } = require('mkdirp');
const path = require('path');
const rollup = require('rollup');
const babel = require('rollup-plugin-babel');

const svgPathRegex = /<path\s([^>]*)>/g;
const svgAttrRegex = /(?:\s*|^)([^= ]*)="([^"]*)"/g;
const validIconName = /^[A-Z]/;

function getRollupInputConfig(target) {
  return {
    external: [target],
    plugins: [
      babel({
        presets: [
          ['es2015', { modules: false }],
          target
        ],
        plugins: [
          'transform-object-rest-spread',
          'external-helpers'
        ]
      })
    ]
  };
}

function normalizeName(name) {
  return name.split(/[ -]/g).map(part => {
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join('') + 'Icon';
}

function checkAllowedAttr(attr, value, content, name) {
  if (attr === 'd') {
    return true
  }
  if (attr === 'fill') {
    if (value === 'none') {
      // Will be filtered out.
      return true
    }
    if (value === '#000') {
      // Default value.
      return true
    }
  }
  if (attr === 'fill-rule' && value === 'nonzero') {
    // Default value.
    return true
  }
  return false
}

function extractPath(content, name) {
  const allPaths = []
  while (true) {
    const svgPathMatches = svgPathRegex.exec(content);
    const svgPath = svgPathMatches && svgPathMatches[1];
    if (!svgPath) {
      break
    }
    const attrs = {}
    while (true) {
      const svgAttrMatches = svgAttrRegex.exec(svgPath);
      if (!svgAttrMatches) {
        break
      }
      if (!checkAllowedAttr(svgAttrMatches[1], svgAttrMatches[2])) {
        throw new Error(
          `Unknown SVG attr in ${name}: ${svgAttrMatches[1]}="${svgAttrMatches[2]}"\n${content}`,
        )
      }
      attrs[svgAttrMatches[1]] = svgAttrMatches[2]
    }
    if (attrs.fill === 'none') {
      continue
    }
    allPaths.push(attrs)
  }
  if (allPaths.length !== 1 || !allPaths[0].d) {
    throw new Error(
      `Wrong number of path in ${name}: ${allPaths.length}\n` +
      `${JSON.stringify(allPaths, undefined, 2)}\n${content}`,
    )
  }
  return allPaths[0].d
}

function collectComponents(svgFilesPath) {
  const svgFiles = fs.readdirSync(svgFilesPath);

  const icons = [];
  for (const svgFile of svgFiles) {
    const svgFilePath = path.join(svgFilesPath, svgFile);

    // Handle sub-directories.
    const stats = fs.statSync(svgFilePath);
    if (stats.isDirectory()) {
      icons.push(...collectComponents(svgFilePath));
      continue;
    }

    const origName = svgFile.slice(0, -4);
    const name = normalizeName(origName);

    if (!validIconName.exec(name)) {
      console.log(`Skipping icon with invalid name: ${svgFilePath}`)
      continue;
    }

    const content = fs.readFileSync(svgFilePath);
    let svgPath
    try {
      svgPath = extractPath(content, svgFilePath);
    } catch (err) {
      // Ignore file.
      console.log(err)
      continue;
    }

    const icon = {
      name: name,
      fileName: name + '.js',
      defFileName: name + '.d.ts',
      svgPath
    };

    icons.push(icon);
  }

  return icons;
}

async function generate(target, jsCb, tsCb, tsAllCb) {
  const basePath = path.resolve(__dirname, '..');
  const svgFilesPath = path.resolve(basePath, 'node_modules/remixicon/icons');
  const buildPath = path.resolve(basePath, 'build');
  mkdirp(buildPath);
  const publishPath = path.resolve(basePath, 'publish-' + target);
  mkdirp(publishPath);
  const distPath = path.resolve(publishPath, 'dist');
  mkdirp(distPath);

  console.log('Collecting components...');
  const components = collectComponents(svgFilesPath);
  console.log('Generating components...');
  const pathsToUnlink = [];
  for (const [index, component] of components.entries()) {
    if (!component.aliasFor) {
      console.log(`Generating ${component.name}... (${index + 1}/${components.length})`);
    } else {
      console.log(`Generating alias ${component.name}... (${index + 1}/${components.length})`);
    }

    const fileContent = jsCb(component);
    const inputPath = path.resolve(buildPath, component.fileName);
    const outputPath = path.resolve(publishPath, component.fileName);

    fs.writeFileSync(inputPath, fileContent);

    const bundle = await rollup.rollup({
      input: inputPath,
      ...getRollupInputConfig(target)
    });

    await bundle.write({
      file: outputPath,
      format: 'cjs'
    });

    // remember paths to unlink later
    if (!pathsToUnlink.includes(inputPath)) {
      pathsToUnlink.push(inputPath);
    }

    const definitionContent = tsCb(component);
    fs.writeFileSync(path.join(publishPath, component.defFileName), definitionContent);
  }

  console.log('Generating typings...');
  // create the global typings.d.ts
  const typingsContent = tsAllCb();
  fs.writeFileSync(path.resolve(distPath, 'typings.d.ts'), typingsContent);

  // clean up
  for (const pathToUnlink of pathsToUnlink) {
    fs.unlinkSync(pathToUnlink);
  }
}

module.exports = generate;
