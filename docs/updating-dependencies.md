# Updating Dependencies

To maintain a simple and lightweight environment, the project primarily uses vanilla JavaScript and is light on third-party libraries, avoiding the need for a package manager.

To update the respective library, simply run a curl command from the project root folder to pull and replace with the latest version.

**`browser-image-compression.js`**:
```
curl -o assets/vendor/browser-image-compression.js https://raw.githubusercontent.com/Donaldcwl/browser-image-compression/refs/heads/master/dist/browser-image-compression.js
```

**`heic-to.js`**:
```
curl -o assets/vendor/heic-to.js https://raw.githubusercontent.com/hoppergee/heic-to/refs/heads/main/dist/iife/heic-to.js
```

**`ico.js`**:
```
curl -o assets/vendor/ico.js https://unpkg.com/icojs/dist/ico.js
```

**`png2ico.js`**:
```
curl -o assets/vendor/png2ico.js https://raw.githubusercontent.com/datvm/PNG2ICOjs/refs/heads/master/src/png2icojs.js

# PNG2ICOjs does not work on vanilla javascript by default as it's an ES module.
# Run the commands below to adjust it to global script.

# On Linux, remove '' from sed -i. On macOS, keep it.
sed -i '' 's/^export class/class/' assets/vendor/png2ico.js

# Exposing class to window to make it globally accessible. 
echo "\nwindow.PngIcoConverter = PngIcoConverter;" >> assets/vendor/png2ico.js
```

**`jszip.js`**:
```
curl -o assets/vendor/jszip.js https://raw.githubusercontent.com/Stuk/jszip/refs/heads/main/dist/jszip.min.js
```

