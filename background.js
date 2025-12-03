let tabStates = {};
let cachedBlockList = ""; // Aquí guardaremos el texto del JSON
let lastUpdate = 0;

// --- 1. GESTIÓN DE LA LISTA DE BLOQUEOS (API JSON) ---

// Función para descargar la lista oficial
async function updateBlockList() {
  try {
    console.log("🔄 Actualizando lista de bloqueos desde API...");
    const response = await fetch('https://hayahora.futbol/estado/data.json');
    
    if (response.ok) {
      const data = await response.json();
      // Truco: Guardamos todo el JSON como una cadena de texto gigante.
      // Así, sea cual sea el formato, si la IP está dentro, la encontraremos.
      cachedBlockList = JSON.stringify(data).toLowerCase();
      lastUpdate = Date.now();
      console.log("✅ Lista actualizada. Tamaño:", cachedBlockList.length);
    } else {
      console.warn("⚠️ Fallo al descargar JSON de hayahora. Status:", response.status);
    }
  } catch (error) {
    console.error("❌ Error de red al actualizar lista:", error);
  }
}

// Actualizar al iniciar y crear alarma para hacerlo cada 30 min
chrome.runtime.onInstalled.addListener(() => {
  updateBlockList();
  chrome.alarms.create("refreshList", { periodInMinutes: 30 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refreshList") updateBlockList();
});

// Por si acaso, intentamos actualizar al arrancar el navegador
updateBlockList();


// --- 2. ESCUCHAR TRÁFICO Y DETECTAR (Igual que antes) ---

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.type !== 'main_frame') return;
    if (!tabStates[details.tabId]) resetTabState(details.tabId);

    let isCloudflare = false;
    let cfInfo = {};

    if (details.responseHeaders) {
      for (const header of details.responseHeaders) {
        const name = header.name.toLowerCase();
        const value = header.value;
        if (name === 'server' && value.toLowerCase().includes('cloudflare')) isCloudflare = true;
        if (name === 'cf-ray') { isCloudflare = true; cfInfo.rayId = value; }
        if (name === 'cf-cache-status') cfInfo.cacheStatus = value;
      }
    }
    
    const detectedIP = details.ip || null;

    tabStates[details.tabId].isCloudflare = isCloudflare;
    tabStates[details.tabId].cfDetails = cfInfo;
    tabStates[details.tabId].serverIP = detectedIP;
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    
    if (!tabStates[tabId]) resetTabState(tabId);
    
    const ipToCheck = tabStates[tabId].serverIP;
    
    // Comprobamos contra la lista en memoria (¡Instantáneo!)
    const blockStatus = checkBlockStatus(tab.url, ipToCheck);
    tabStates[tabId].blockStatus = blockStatus;

    // --- PRIORIDAD DE ICONOS ---
    let finalIcon = "cf-off.png"; 

    // Como es un historial, usaremos el icono AMARILLO (Warning) 
    // porque estar en la lista no garantiza bloqueo activo en TU operador,
    // pero sí indica "Peligro / Fichado".
    if (blockStatus === 'listed') {
      finalIcon = "cf-blocked.png"; 
    } else if (tabStates[tabId].isCloudflare) {
      finalIcon = "cf-on.png";
    }

    chrome.action.setIcon({ tabId: tabId, path: finalIcon });
    chrome.storage.local.set({ [tabId]: tabStates[tabId] });
  }
});

function resetTabState(tabId) {
  tabStates[tabId] = { 
    isCloudflare: false, 
    cfDetails: {}, 
    blockStatus: 'clean', 
    serverIP: null 
  };
}

// Función síncrona (ya no necesita async/await porque la lista está en memoria)
function checkBlockStatus(currentUrl, ipAddress) {
  if (!cachedBlockList) return 'clean'; // Si aún no ha cargado la lista

  try {
    const urlObj = new URL(currentUrl);
    const domain = urlObj.hostname.replace(/^www\./, '').toLowerCase();

    // BÚSQUEDA RÁPIDA EN EL TEXTO DEL JSON
    // 1. ¿Está la IP en la lista?
    const ipFound = ipAddress ? cachedBlockList.includes(ipAddress) : false;

    // 2. ¿Está el dominio en la lista?
    const domainFound = cachedBlockList.includes(domain);

    if (ipFound || domainFound) {
        return 'listed'; // Devolvemos estado "listado"
    }
    return 'clean';

  } catch (error) {
    console.error("Error comprobando:", error);
    return 'clean';
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabStates[tabId];
  chrome.storage.local.remove(tabId.toString());
});