
async function downloadAllImages() {
  const GB = 1024 * 1024 * 1024;
  const chunkSize = 1 * GB;
  const zipFileName = appendFileNameId("mazanoke-images");

  try {
    if (state.isDownloadingAll) return;
    state.isDownloadingAll = true;
    ui.actions.downloadAll.setAttribute("aria-busy", "true");

    const compressedImages = document.querySelectorAll(
      'a.image-output__item-download-button[href^="blob:"]'
    );
    const blobs = await Promise.all(
      Array.from(compressedImages).map(async (link, index) => {
        try {
          const response = await fetch(link.href);
          if (!response.ok)
            throw new Error(`Failed to fetch image ${index + 1}`);
          return await response.blob();
        } catch (error) {
          console.error(`Error downloading image ${index + 1}:`, error);
          return null;
        }
      })
    );

    const validBlobs = blobs.filter((blob) => blob !== null);

    if (validBlobs.length === 0) {
      throw new Error("No valid images to download");
    }

    let currentZip = zip;
    let totalSize = 0;
    let zipIndex = 1;

    for (let i = 0; i < validBlobs.length; i++) {
      const fileSize = parseInt(compressedImages[i].dataset.filesize, 10);

      if (totalSize + fileSize > chunkSize) {
        const zipBlob = await currentZip.generateAsync({ type: "blob" });
        await triggerDownload(
          zipBlob,
          `${zipFileName}-${zipIndex.toString().padStart(3, "0")}.zip`
        );

        currentZip = new lib.jsZip();
        totalSize = 0;
        zipIndex++;
      }

      currentZip.file(compressedImages[i].download, validBlobs[i]);
      totalSize += fileSize;
    }

    if (totalSize > 0) {
      const finalName =
        zipIndex === 1
          ? `${zipFileName}.zip`
          : `${zipFileName}-${zipIndex.toString().padStart(3, "0")}.zip`;
      const zipBlob = await currentZip.generateAsync({ type: "blob" });
      await triggerDownload(zipBlob, finalName);
    }
  }
  catch (error) {
    console.error("Download all images as zip failed:", error);
  }
  finally {
    ui.actions.downloadAll.setAttribute("aria-busy", "false");
    state.isDownloadingAll = false;
  }
}

async function triggerDownload(blob, filename) {
  return new Promise((resolve) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      resolve();
    }, 100);
  });
}

function deleteImage(elementId) {
  if (!elementId) { return }
  const image = document.getElementById(elementId);
  image.classList.add("fade-out-shrink");
  ui.output.subpageOutput.dataset.count--;
  ui.output.imageCount.dataset.count--;
  ui.output.imageCount.textContent--;
  state.outputImageCount--;
  image.addEventListener("animationend", () => {
    ui.output.container.dataset.count--;
    image.remove();
  }, { once: true }); 
}

function deleteAllImages() {
  ui.output.content.classList.add("fade-out-shrink");
  ui.output.subpageOutput.dataset.count = 0;
  ui.output.imageCount.dataset.count = 0;
  ui.output.imageCount.textContent = 0;
  state.outputImageCount = 0;
  ui.output.content.addEventListener("animationend", () => {
    ui.output.container.dataset.count = 0;
    ui.output.content.innerHTML = "";
  ui.output.content.classList.remove("fade-out-shrink");
  }, { once: true }); 
}
