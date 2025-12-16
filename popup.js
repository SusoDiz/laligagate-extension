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
    
    const ispBlockedContainer = document.getElementById('isp-blocked-container');
    const ispBlockedList = document.getElementById('isp-blocked-list');
    const ispListedContainer = document.getElementById('isp-listed-container');
    const ispListedList = document.getElementById('isp-listed-list');

    if (!data) {
      blockBox.textContent = "Recargando...";
      return;
    }

    // --- MOSTRAR ESTADO DE BLOQUEO CON DETALLES ---
    const blockStatus = data.blockStatus;
    
    if (blockStatus && blockStatus.status === 'blocked') {
      // Está actualmente bloqueada por al menos un ISP
      blockBox.textContent = "🔴 ACTUALMENTE BLOQUEADA";
      blockBox.className = "status-box block-blocked"; 
      
      // Mostrar ISPs que están bloqueando
      ispBlockedContainer.style.display = "block";
      ispBlockedList.innerHTML = '';
      
      if (blockStatus.details && blockStatus.details.blockedByISPs) {
        blockStatus.details.blockedByISPs.forEach(isp => {
          const ispDiv = document.createElement('div');
          ispDiv.className = 'isp-block';
          
          const timestamp = new Date(isp.timestampStr).toLocaleString('es-ES');
          ispDiv.innerHTML = `
            <div class="isp-name">🚫 ${isp.isp}</div>
            <div class="isp-timestamp">Bloqueado desde: ${timestamp}</div>
          `;
          ispBlockedList.appendChild(ispDiv);
        });
      }
      
      // Mostrar ISPs que tienen listado pero no están bloqueando
      if (blockStatus.details && blockStatus.details.listedButNotBlockedISPs && blockStatus.details.listedButNotBlockedISPs.length > 0) {
        ispListedContainer.style.display = "block";
        ispListedList.innerHTML = '';
        
        blockStatus.details.listedButNotBlockedISPs.forEach(isp => {
          const ispDiv = document.createElement('div');
          ispDiv.className = 'isp-block listed';
          
          const timestamp = new Date(isp.timestampStr).toLocaleString('es-ES');
          ispDiv.innerHTML = `
            <div class="isp-name">⏱️ ${isp.isp}</div>
            <div class="isp-timestamp">Última vez bloqueada: ${timestamp}</div>
          `;
          ispListedList.appendChild(ispDiv);
        });
      }
      
    } else if (blockStatus && blockStatus.status === 'listed') {
      // Listada pero no actualmente bloqueada
      blockBox.textContent = "⚠️ LISTADA / HISTÓRICAMENTE BLOQUEADA";
      blockBox.className = "status-box block-listed"; 
      
      // Mostrar ISPs que la tenían listada
      ispListedContainer.style.display = "block";
      ispListedList.innerHTML = '';
      
      if (blockStatus.details && blockStatus.details.listedButNotBlockedISPs) {
        blockStatus.details.listedButNotBlockedISPs.forEach(isp => {
          const ispDiv = document.createElement('div');
          ispDiv.className = 'isp-block listed';
          
          const timestamp = new Date(isp.timestampStr).toLocaleString('es-ES');
          ispDiv.innerHTML = `
            <div class="isp-name">⏱️ ${isp.isp}</div>
            <div class="isp-timestamp">Última vez bloqueada: ${timestamp}</div>
          `;
          ispListedList.appendChild(ispDiv);
        });
      }
      
    } else {
      // Limpia
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