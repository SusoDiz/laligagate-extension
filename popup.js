document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  chrome.storage.local.get(tab.id.toString(), (result) => {
    const data = result[tab.id];

    // Elementos HTML
    const cfBox = document.getElementById('cf-status');
    const detailsBox = document.getElementById('cf-details');
    const blockBox = document.getElementById('block-status');
    const rayIdElem = document.getElementById('ray-id');
    const cacheElem = document.getElementById('cache-status');

    if (!data) {
      blockBox.textContent = "Recargando...";
      return;
    }

    // --- MOSTRAR ESTADO DE BLOQUEO ---
    if (data.blockStatus === 'listed') {
      blockBox.textContent = "⚠️ BLOQUEADA / AFECTADA";
      blockBox.className = "status-box block-warning"; 
    } else {
      blockBox.textContent = "✅ No está bloqueada";
      blockBox.className = "status-box block-safe"; 
    }

    // --- DATOS SEGUROS ---
    const rayId = data.cfDetails?.rayId || "N/A";
    const cacheStatus = data.cfDetails?.cacheStatus || "N/A";

    // --- MOSTRAR CLOUDFLARE ---
    if (data.isCloudflare) {
      cfBox.textContent = "☁️ USANDO CLOUDFLARE";
      cfBox.className = "status-box cf-yes";
      
      // Mostramos detalles técnicos
      detailsBox.style.display = "block";
      rayIdElem.textContent = rayId;
      cacheElem.textContent = cacheStatus;
      
    } else {
      cfBox.textContent = "Sin Cloudflare";
      cfBox.className = "status-box cf-no";
      
      // Ocultamos la caja de detalles porque sin CF no hay RayID ni Cache útil
      detailsBox.style.display = "none";
    }
  });
});