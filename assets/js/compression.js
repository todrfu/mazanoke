/**
 * Adding support for more image formats
 * =====================================
 * 1. Update accepted file types in the HTML input: `<input id="compress" type="file" accept="...">`.
 * 2. Register the new mime types in: `isFileTypeSupported()`, `mimeToExtension()`.  
 * 3. Preprocess to canvas-compatible blob in `preProcessImage()`, before compression `compressImageQueue()`.
 * 4. If the final output format, `selectedFormat`, is not JPG, WebP, or PNG, it needs to be encoded in `postProcessImage()`.
 * 5. If external libraries were used, they need to be included in `service-worker.js` to provide cached offline use.
 */

/**
 * TODO 2025-06-06: Refactor toast into reusable component, for showing e.g. "undo delete", error messages.
 * TODO 2025-06-06: Refactor deleteImage(), downloadAllImages(), to support "undo delete" with countdown.
 */

/**
 * Image compression module
 * Handles image compression, format conversion, and related functionality
 */

// File size limit configuration (MB)
const MAX_FILE_SIZE_MB = 50; // Maximum file size limit (user requirement: support up to 50MB)
const WARNING_FILE_SIZE_MB = 20; // Warning threshold
const LARGE_FILE_AUTO_RESIZE_MB = 30; // Auto-resize threshold - files larger than this will be automatically resized
const LARGE_FILE_MAX_DIMENSION = 4000; // Maximum dimension for large files auto-resize (pixels)

function compressImage(event) {
  // Entry point for image compression
  const files = Array.from(event.target.files);
  
  // Check file sizes and filter out oversized files
  const validFiles = [];
  const skippedFiles = [];
  
  for (const file of files) {
    const fileSizeMB = file.size / 1024 / 1024;
    
    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      skippedFiles.push({ name: file.name, size: fileSizeMB });
      console.warn(App.i18n.getTranslation('error.file.exceedsLimit', null, {
        fileName: file.name,
        size: fileSizeMB.toFixed(2),
        maxSize: MAX_FILE_SIZE_MB
      }));
    } else if (fileSizeMB > WARNING_FILE_SIZE_MB) {
      console.warn(App.i18n.getTranslation('error.file.largeWarning', null, {
        fileName: file.name,
        size: fileSizeMB.toFixed(2)
      }));
      validFiles.push(file);
    } else {
      validFiles.push(file);
    }
  }
  
  // Show alert if files were skipped
  if (skippedFiles.length > 0) {
    const skippedNames = skippedFiles.map(f => `"${f.name}" (${f.size.toFixed(2)}MB)`).join(', ');
    alert(App.i18n.getTranslation('error.file.tooLarge', null, {
      maxSize: MAX_FILE_SIZE_MB,
      files: skippedNames
    }));
  }
  
  // Return early if no valid files
  if (validFiles.length === 0) {
    if (files.length > 0) {
      alert(App.i18n.getTranslation('error.file.noValidFiles', null, {
        maxSize: MAX_FILE_SIZE_MB
      }));
    }
    return;
  }
  
  state.controller = new AbortController();
  state.compressQueue = validFiles;
  state.compressQueueTotal = validFiles.length;
  state.compressProcessedCount = 0;
  state.fileProgressMap = {};
  state.isCompressing = true;
  
  document.body.classList.add("compressing--is-active");
  ui.actions.dropZone.classList.add("hidden");
  ui.actions.abort.classList.remove("hidden");
  ui.progress.container.classList.remove("hidden");
  ui.progress.text.innerHTML = `${App.i18n.getTranslation('process.preparing')}<span class="loading-dots">`;

  compressImageQueue();
}

async function compressImageQueue() {
  if (!state.compressQueue.length) {
    resetCompressionState(true);
    return;
  }

  const file = state.compressQueue[0];
  const i = state.compressProcessedCount;

  console.log(App.i18n.getTranslation('log.input.file') + ':', file);

  if (!isFileTypeSupported(file.type, file)) {
    console.error(App.i18n.getTranslation('error.unsupported.type', null, {
      type: file.type,
      fileName: file.name
    }));
    ui.progress.text.innerHTML = `Unsupported file "<div class='progress-file-name'>${file.name}</div>"`;
    state.compressQueue.shift();
    await compressImageQueue();
    return;
  }

  try {
    const fileSizeMB = file.size / 1024 / 1024;
    
    // Use longer delay for large files to ensure UI responsiveness
    const yieldDelay = fileSizeMB > WARNING_FILE_SIZE_MB ? 50 : 16;
    
    // Use yieldToMain to avoid blocking main thread for long periods
    await yieldToMain(yieldDelay);
    
    // Update progress display
    if (fileSizeMB > WARNING_FILE_SIZE_MB) {
      ui.progress.text.innerHTML = `${App.i18n.getTranslation('process.optimizing')} "<div class='progress-file-name'>${file.name}</div>" <small>(${App.i18n.getTranslation('process.preparing.status')})</small>`;
    }

    // Decode and parse image to validate options
    const options = await createCompressionOptions((p) => currentProgress(p, i, file.name), file);
    
    // Yield main thread again
    await yieldToMain(yieldDelay);
    
    // Preprocess image when needed (e.g., decoding or precompress image)
    // For large files, preprocessing operations are chunked
    const { preProcessedImage, preProcessedNewFileType } = await preProcessImage(file);
    const selectedFormat = getCheckedValue(ui.inputs.formatSelect)

    if (preProcessedImage) {
      options.fileType = preProcessedNewFileType;
    }
    if (isPostProcessingRequired(selectedFormat)) {
      options.fileType = 'image/png';
    }

    // Yield again to ensure UI responsiveness
    await yieldToMain(yieldDelay);
    
    // Update progress display
    if (fileSizeMB > WARNING_FILE_SIZE_MB) {
      ui.progress.text.innerHTML = `${App.i18n.getTranslation('process.optimizing')} "<div class='progress-file-name'>${file.name}</div>" <small>(${App.i18n.getTranslation('process.compressing.status')})</small>`;
    }

  // Perform image compression
  lib.imageCompression((preProcessedImage || file), options)
      .then((compressedImage) => {
        // Release memory of preprocessed image
        if (preProcessedImage && preProcessedImage !== file) {
          if (preProcessedImage instanceof Blob && preProcessedImage.url) {
            URL.revokeObjectURL(preProcessedImage.url);
          }
        }
        return getImageDimensions(compressedImage).then((dimensions) => ({
          image: compressedImage,
          ...dimensions,
        }));
      })
    .then(({ image, outputImageWidth, outputImageHeight }) =>
      generateThumbnailImage(image, { outputImageWidth, outputImageHeight })
    )
    .then(({ sourceImage, thumbnailImage, outputImageWidth, outputImageHeight }) =>
      // Postprocess image when needed (e.g., finalize by converting to the targeted file format)
      postProcessImage(sourceImage, selectedFormat, { outputImageWidth, outputImageHeight }).then(
        ({ postProcessedImage }) => ({
          postProcessedImage,
          thumbnailImage,
          outputImageWidth,
          outputImageHeight
        })
      )
    )
    .then(({ postProcessedImage, thumbnailImage, outputImageWidth, outputImageHeight }) =>
      handleCompressionResult(file, postProcessedImage, thumbnailImage, outputImageWidth, outputImageHeight)
    )
      .catch((error) => {
        console.error(App.i18n.getTranslation('error.compression.failed') + ':', error.message);
        // Display error message to user
        ui.progress.text.innerHTML = `<div class='badge badge--error'>${App.i18n.getTranslation('error.processing.file', null, {
          fileName: file.name,
          message: error.message
        })}</div>`;
      })
    .finally(() => {
      state.compressProcessedCount++;
      state.compressQueue.shift();
      if (state.compressProcessedCount === 1) {
        selectSubpage("output");
      }
      resetCompressionState(state.compressProcessedCount === state.compressQueueTotal);
      if (state.compressProcessedCount < state.compressQueueTotal) {
        compressImageQueue();
      }
    });
  } catch (error) {
    console.error(App.i18n.getTranslation('error.processing.failed') + ':', error);
    state.compressProcessedCount++;
    state.compressQueue.shift();
    if (state.compressProcessedCount < state.compressQueueTotal) {
      compressImageQueue();
    } else {
      resetCompressionState(true);
    }
  }

  function currentProgress(p, index, fileName) {
    const overallProgress = calculateOverallProgress(
      state.fileProgressMap,
      state.compressQueueTotal
    );
    const fileNameShort =
      fileName.length > 15 ? fileName.slice(0, 12) + "..." : fileName;
    state.fileProgressMap[index] = p;

    ui.progress.queueCount.textContent = `${
      state.compressProcessedCount + 1
    } / ${state.compressQueueTotal}`;
    ui.progress.text.dataset.progress = overallProgress;
    ui.progress.text.innerHTML = `${App.i18n.getTranslation('process.optimizing')} "<div class='progress-file-name'>${fileName}</div>"`;
    ui.progress.bar.style.width = overallProgress + "%";
    console.log(`${App.i18n.getTranslation('process.optimizing')} "${fileNameShort}" (${overallProgress}%)`);

    if (p === 100 && state.compressProcessedCount === state.compressQueueTotal - 1) {
      ui.progress.text.innerHTML = `
        <div class="badge badge--success pt-2xs pb-2xs bg:surface">
          <div class="badge-text flex items-center gap-3xs">
            <svg height="16" stroke-linejoin="round" viewBox="0 0 16 16" width="16" style="color: currentcolor;"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.5 8C14.5 11.5899 11.5899 14.5 8 14.5C4.41015 14.5 1.5 11.5899 1.5 8C1.5 4.41015 4.41015 1.5 8 1.5C11.5899 1.5 14.5 4.41015 14.5 8ZM16 8C16 12.4183 12.4183 16 8 16C3.58172 16 0 12.4183 0 8C0 3.58172 3.58172 0 8 0C12.4183 0 16 3.58172 16 8ZM11.5303 6.53033L12.0607 6L11 4.93934L10.4697 5.46967L6.5 9.43934L5.53033 8.46967L5 7.93934L3.93934 9L4.46967 9.53033L5.96967 11.0303C6.26256 11.3232 6.73744 11.3232 7.03033 11.0303L11.5303 6.53033Z" fill="currentColor"></path></svg>
            <span>${App.i18n.getTranslation('process.done')}</span>
          </div>
        <div>
      `;
    }
  }
}

async function createCompressionOptions(currentProgress, file) {
  const compressMethod = getCheckedValue(ui.inputs.compressMethod);
  const dimensionMethod = getCheckedValue(ui.inputs.dimensionMethod);
  const maxWeight = getMaxWeight();
  const quality = Math.min(Math.max(parseFloat(ui.inputs.quality.value) / 100, 0), 1);
  let { inputFileType, selectedFormat } = getFileType(file);

  selectedFormat = resolveFinalFormat(inputFileType, selectedFormat);
  let limitDimensions = await getLimitDimensions(file, dimensionMethod);
  
  const fileSizeMB = file.size / 1024 / 1024;
  console.log(App.i18n.getTranslation('log.input.size') + ":", fileSizeMB.toFixed(3), "MB");

  // For large files (over 30MB), automatically limit maximum dimensions to avoid memory issues and freezing
  // If user hasn't set dimension limits, automatically add a reasonable limit
  if (fileSizeMB > LARGE_FILE_AUTO_RESIZE_MB && dimensionMethod !== "limit") {
    // Auto-limit to 4000px, a reasonable upper bound that maintains quality while avoiding freezing
    limitDimensions = LARGE_FILE_MAX_DIMENSION;
    console.log(App.i18n.getTranslation('log.largeFile.autoResize', null, {
      size: fileSizeMB.toFixed(2),
      dimension: limitDimensions
    }));
  }

  const options = {
    maxSizeMB: compressMethod === "limitWeight" ? maxWeight : fileSizeMB.toFixed(3),
    initialQuality: compressMethod === "quality" ? quality : undefined,
    // For large files, apply auto-limit even if user hasn't set a limit
    maxWidthOrHeight: (dimensionMethod === "limit" ? limitDimensions : 
                       (fileSizeMB > LARGE_FILE_AUTO_RESIZE_MB ? limitDimensions : undefined)),
    useWebWorker: true, // Ensure Web Worker is used to avoid blocking main thread
    onProgress: currentProgress,
    preserveExif: false,
    fileType: selectedFormat || undefined,
    libURL: "./browser-image-compression.js",
    // For large files, allow resolution adjustment to optimize performance
    alwaysKeepResolution: fileSizeMB <= LARGE_FILE_AUTO_RESIZE_MB,
  };
  if (state.controller) {
    options.signal = state.controller.signal;
  }

  console.log(App.i18n.getTranslation('log.settings') + ":", options);
  return options;
}

async function preProcessImage(file) {
  if (file.type === "image/heic" || file.type === "image/heif" || isHeicExt(file)) {
    return await preProcessHeic(file);
  }

  if (file.type === "image/avif") {
    return await preProcessAvif(file);
  }

  if (file.type === "image/vnd.microsoft.icon" || file.type === "image/x-icon") {
    return await preProcessIco(file);
  }

  if (file.type === "image/tiff" || file.type === "image/dng" || file.type === "image/x-adobe-dng") {
    return await preProcessTiff(file);
  }

  return { preProcessedImage: null, preProcessedNewFileType: null };
}

async function preProcessHeic(file) {
  console.log(App.i18n.getTranslation('log.preprocess.heic'));
  const image = await lib.heicTo({
    blob: file,
    type: "image/jpeg",
    quality: 0.9,
  });
  return { preProcessedImage: image, preProcessedNewFileType: "image/jpeg" };
}

async function preProcessAvif(file) {
  console.log(App.i18n.getTranslation('log.preprocess.avif'));
  const image = await lib.imageCompression(file, config.avifPreProcessOptions);
  return { preProcessedImage: image, preProcessedNewFileType: "image/jpeg" };
}

async function preProcessIco(file) {
  try {
    const fileSizeMB = file.size / 1024 / 1024;
    const yieldDelay = fileSizeMB > WARNING_FILE_SIZE_MB ? 50 : 16;
    
    // Yield main thread for large files
    await yieldToMain(yieldDelay);
    
    const arrayBuffer = await file.arrayBuffer();
    
    if (!lib.icoJs.isICO(arrayBuffer)) {
      return { preProcessedImage: null, preProcessedNewFileType: null };
    }

    // Yield main thread again
    await yieldToMain(yieldDelay);
    
    const parsedIco = await lib.icoJs.parseICO(arrayBuffer, "image/png");
    const rawImage = parsedIco[0];
    const blob = await decodeImageBufferToBlob(rawImage.buffer, "image/png", 1);
    return { preProcessedImage: blob, preProcessedNewFileType: "image/png" };
  } catch (error) {
    console.error(App.i18n.getTranslation('error.preprocess.ico') + ':', error);
    throw error;
  }
}

async function preProcessTiff(file) {
  try {
    const fileSizeMB = file.size / 1024 / 1024;
    const yieldDelay = fileSizeMB > WARNING_FILE_SIZE_MB ? 50 : 16;
    
    // Yield main thread for large files
    await yieldToMain(yieldDelay);
    
    const arrayBuffer = await file.arrayBuffer();
    
    // Yield main thread again
    await yieldToMain(yieldDelay);
    
    const ifds = lib.utif.decode(arrayBuffer);
    lib.utif.decodeImage(arrayBuffer, ifds[0]);
    
    // Yield main thread again
    await yieldToMain(yieldDelay);
    
    const rgba = lib.utif.toRGBA8(ifds[0]);
    const parsedTiff = await encodeImageRgbaToBlob(rgba, ifds[0].width, ifds[0].height, "image/png", 1);
    return { preProcessedImage: parsedTiff, preProcessedNewFileType: "image/png" };
  } catch (error) {
    console.error(App.i18n.getTranslation('error.preprocess.tiff') + ':', error);
    throw error;
  }
}

async function postProcessImage(file, selectedFormat, dimensions) {
  console.log(App.i18n.getTranslation('log.postprocess'));

  if (selectedFormat === "image/vnd.microsoft.icon" || selectedFormat === "image/x-icon") {
    // Convert the compressed image to ICO
    file = await postProcessToIco(file);
  }
  return { postProcessedImage: file, ...dimensions };
}

async function postProcessToIco(pngFile) {
  const inputs = [{ png: pngFile, ignoreSize: true }];

  try {
    return await new lib.pngToIco().convertToBlobAsync(inputs, 'image/vnd.microsoft.icon');
  } catch (e) {
    console.error(e);
    const msg = e.message;
    if (msg) {
      alert(App.i18n.getTranslation('error.postprocess.ico', null, {
        message: ErrorMessages[msg] ?? msg
      }));
    }
  }
}

/**
 * Yield main thread control to avoid long blocking
 * Uses requestIdleCallback or setTimeout as fallback
 * For large file processing, uses longer delay to ensure UI responsiveness
 */
function yieldToMain(delay = 16) {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        // Use setTimeout to ensure execution in next event loop
        // Use approximately one frame time (16ms) to give browser a chance to update UI
        setTimeout(resolve, delay);
      }, { timeout: 50 });
    } else {
      // Fallback: use setTimeout, at least one frame time
      setTimeout(resolve, delay);
    }
  });
}

function decodeImageBufferToBlob(buffer, outputType = 'image/png', quality = 1) {
  return new Promise(async (resolve, reject) => {
    try {
      const blob = new Blob([buffer], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      
      // Estimate image size (based on buffer size)
      const estimatedSizeMB = buffer.byteLength / 1024 / 1024;
      const yieldDelay = estimatedSizeMB > WARNING_FILE_SIZE_MB ? 50 : 16;

      img.onload = async () => {
        try {
          // Yield main thread for large images
          await yieldToMain(yieldDelay);
          
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          
          // Yield main thread again to avoid Canvas operations blocking
          await yieldToMain(yieldDelay);
          
          ctx.drawImage(img, 0, 0);
          
          // Yield main thread again to ensure drawImage completes
          await yieldToMain(yieldDelay);
          
          // Wrap toBlob in Promise and add timeout handling
          const blobPromise = new Promise((blobResolve, blobReject) => {
            const timeout = setTimeout(() => {
              blobReject(new Error(App.i18n.getTranslation('error.canvas.timeout')));
            }, 120000); // Large files may need more time, increased to 120 seconds
            
            canvas.toBlob((resultBlob) => {
              clearTimeout(timeout);
              URL.revokeObjectURL(url);
              if (resultBlob) blobResolve(resultBlob);
              else blobReject(new Error('Failed to create blob'));
            }, outputType, quality);
          });
          
          const resultBlob = await blobPromise;
          resolve(resultBlob);
        } catch (error) {
          URL.revokeObjectURL(url);
          reject(error);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };

      img.src = url;
    } catch (error) {
      reject(error);
    }
  });
}

function encodeImageRgbaToBlob(rgba, width, height, outputType = 'image/png', quality = 1) {
  return new Promise(async (resolve, reject) => {
    try {
      // Estimate image size (based on pixel count)
      const pixelCount = width * height;
      const estimatedSizeMB = (pixelCount * 4) / 1024 / 1024; // RGBA = 4 bytes per pixel
      const yieldDelay = estimatedSizeMB > WARNING_FILE_SIZE_MB ? 50 : 16;
      
      // Yield main thread for large images
      await yieldToMain(yieldDelay);
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      
      // Yield main thread again
      await yieldToMain(yieldDelay);
      
      const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
      ctx.putImageData(imageData, 0, 0);
      
      // Yield main thread again to ensure putImageData completes
      await yieldToMain(yieldDelay);
      
      // Wrap toBlob in Promise and add timeout handling
      const blobPromise = new Promise((blobResolve, blobReject) => {
        const timeout = setTimeout(() => {
          blobReject(new Error(App.i18n.getTranslation('error.canvas.timeout')));
        }, 120000); // Large files may need more time, increased to 120 seconds
        
        canvas.toBlob(blob => {
          clearTimeout(timeout);
          if (blob) blobResolve(blob);
          else blobReject(new Error('Failed to create blob'));
        }, outputType, quality);
      });
      
      const blob = await blobPromise;
      resolve(blob);
    } catch (error) {
      reject(error);
    }
  });
}

async function getLimitDimensions(file, dimensionMethod) {
  if (dimensionMethod !== "limit") return undefined;

  const limit = ui.inputs.limitDimensions.value;
  const fileSizeMB = file.size / 1024 / 1024;
  const yieldDelay = fileSizeMB > WARNING_FILE_SIZE_MB ? 50 : 16;

  if (["image/heif", "image/heic"].includes(file.type) || isHeicExt(file)) {
    // Yield main thread for large files
    await yieldToMain(yieldDelay);
    
    const buffer = await file.arrayBuffer();
    
    // Yield main thread again
    await yieldToMain(yieldDelay);
    
    const img = new lib.libheif.HeifDecoder().decode(buffer)[0];
    return await getAdjustedDimensions({ width: img.get_width(), height: img.get_height() }, limit);
  }

  if (file.type === "image/tiff") {
    // Yield main thread for large files
    await yieldToMain(yieldDelay);
    
    const buffer = await file.arrayBuffer();
    
    // Yield main thread again
    await yieldToMain(yieldDelay);
    
    const ifds = lib.utif.decode(buffer);
    lib.utif.decodeImage(buffer, ifds[0]);
    return await getAdjustedDimensions({ width: ifds[0].width, height: ifds[0].height }, limit);
  }

  return await getAdjustedDimensions({ imageBlob: file }, limit);
}

function getMaxWeight() {
  const weight = parseFloat(ui.inputs.limitWeight.value);
  return ui.inputs.limitWeightUnit.value.toUpperCase() === "KB" ? weight / 1024 : weight;
}

function resolveFinalFormat(inputType, userFormat) {
  const fallback = ["image/jpeg", "image/png", "image/webp"];
  if (isPostProcessingRequired(userFormat)) {
    return fallback.includes(inputType) ? inputType : "image/png";
  }
  return userFormat;
}

async function generateThumbnailImage(file, dimensions) {
  const sourceImage = file;
  const thumbnailImage = await lib.imageCompression(file, config.thumbnailOptions);
  return { thumbnailImage, sourceImage, ...dimensions };
}

async function handleCompressionResult(file, output, thumbnailBlob, outputImageWidth, outputImageHeight) {
  const { outputFileExtension, selectedFormat } = getFileType(file);
  const outputImageBlob = URL.createObjectURL(output);

  const { renamedFileName, isBrowserDefaultFileName } = renameBrowserDefaultFileName(file.name);
  const outputFileNameText = updateFileExtension(
    isBrowserDefaultFileName ? renamedFileName : file.name,
    outputFileExtension,
    selectedFormat
  );

  const inputFileSize = parseFloat((file.size / 1024 / 1024).toFixed(3));
  const outputFileSize = parseFloat((output.size / 1024 / 1024).toFixed(3));
  const fileSizeSaved = inputFileSize - outputFileSize;
  const fileSizeSavedPercentage =
    inputFileSize > 0
      ? Math.abs(((fileSizeSaved / inputFileSize) * 100).toFixed(2))
      : "0";
  const fileSizeSavedTrend =
    fileSizeSaved < 0 ? "+" : fileSizeSaved > 0 ? "-" : "";
  const fileSizeSavedClass =
    fileSizeSaved <= 0 ? "badge--error" : "badge--success";

  const thumbnailDataURL = URL.createObjectURL(thumbnailBlob);

  const outputHTML = buildOutputItemHTML({
    outputImageBlob,
    thumbnailDataURL,
    outputFileNameText,
    outputFileExtension,
    width: outputImageWidth,
    height: outputImageHeight,
    fileSize: output.size,
    fileSizeSavedTrend,
    fileSizeSavedPercentage,
    fileSizeSavedClass,
  });

  const wrapper = document.createElement("div");
  wrapper.innerHTML = outputHTML.trim();
  ui.output.content.prepend(wrapper.firstChild);
  await updateImageCounter(1).then( () => updateOutputEmptyState());
}

function calculateOverallProgress(progressMap, totalFiles) {
  const sum = Object.values(progressMap).reduce((acc, val) => acc + val, 0);
  return Math.round(sum / totalFiles);
}

function resetCompressionState(isAllProcessed, aborted) {
  const resetState = () => {
    state.compressProcessedCount = 0;
    state.compressQueueTotal = 0;
    ui.progress.queueCount.textContent = "";
    state.compressQueue = [];
    state.isCompressing = false;
  };

  if (aborted) {
    resetUI();
    resetState();
    return;
  }

  if (isAllProcessed) {
    ui.actions.abort.classList.add("hidden");
    ui.progress.bar.style.width = "100%";

    setTimeout(() => {
      // Delay state reset to allow "Done" message to remain 
      resetUI();
      state.isCompressing = false;
    }, 1000);
    return;
  }

  if (state.isCompressing && state.compressProcessedCount === 0) {
    ui.progress.text.dataset.progress = 0;
    ui.progress.text.textContent = `${App.i18n.getTranslation('process.preparing')} 0%`;
    ui.progress.bar.style.width = "0%";
  }
}

