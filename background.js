let tabStates = {};
let cachedBlockList = { ips: new Set(), lastUpdate: 0 }; // Estructura mejorada
let lastUpdate = 0;

// --- 1. GESTIÓN DE LA LISTA DE BLOQUEOS (API JSON) ---

// Función para descargar la lista oficial
async function updateBlockList() {
  try {
    console.log("🔄 Actualizando lista de bloqueos desde API...");
    const response = await fetch('https://hayahora.futbol/estado/data.json');
    
    if (response.ok) {
      const data = await response.json();
      // Extraer todas las IPs únicas de la lista de forma eficiente
      const ips = new Set();
      if (data.data && Array.isArray(data.data)) {
        data.data.forEach(entry => {
          if (entry.ip) {
            ips.add(entry.ip.toLowerCase());
          }
        });
      }
      cachedBlockList = {
        ips: ips,
        lastUpdate: Date.now()
      };
      lastUpdate = Date.now();
      console.log("✅ Lista actualizada. IPs únicas encontradas:", ips.size);
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
    
    // Dar un pequeño delay para que el evento onHeadersReceived se haya ejecutado
    // y tengamos la IP disponible
    await new Promise(resolve => setTimeout(resolve, 50));
    
    let ipToCheck = tabStates[tabId].serverIP;
    let cloudflareDetected = tabStates[tabId].isCloudflare; // Del header
    
    // Si no tenemos IP del header (porque está bloqueado), intentamos resolverla via DNS
    if (!ipToCheck) {
      try {
        const urlObj = new URL(tab.url);
        const domain = urlObj.hostname;
        console.log("📡 Resolviendo dominio via DNS API:", domain);
        ipToCheck = await resolveDomainViaAPI(domain);
        if (ipToCheck) {
          console.log("✅ Dominio resuelto a:", ipToCheck);
          tabStates[tabId].serverIP = ipToCheck;
          
          // Detectar si la IP es de Cloudflare
          if (isCloudflareIP(ipToCheck)) {
            cloudflareDetected = true;
            tabStates[tabId].isCloudflare = true;
            console.log("☁️ Cloudflare detectado desde IP resuelta");
          }
        }
      } catch (error) {
        console.error("❌ Error resolviendo dominio:", error);
      }
    }
    
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
    } else if (cloudflareDetected) {
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

// Función síncrona mejorada para búsqueda eficiente
function checkBlockStatus(currentUrl, ipAddress) {
  if (!cachedBlockList.ips || cachedBlockList.ips.size === 0) {
    console.log("⚠️ Lista de bloqueos vacía para URL:", currentUrl);
    return 'clean';
  }

  try {
    const urlObj = new URL(currentUrl);
    const domain = urlObj.hostname.replace(/^www\./, '').toLowerCase();

    // BÚSQUEDA EFICIENTE: Comprobar la IP de forma precisa (no substring)
    if (ipAddress) {
      const ipLower = ipAddress.toLowerCase();
      if (cachedBlockList.ips.has(ipLower)) {
        console.log("🔴 IP BLOQUEADA:", ipLower, "para dominio:", domain);
        return 'listed';
      }
    }

    // Log para debugging
    console.log("✅ Dominio:", domain, "IP:", ipAddress || "N/A", "Estado: LIMPIO");
    return 'clean';

  } catch (error) {
    console.error("Error comprobando bloqueo:", error);
    return 'clean';
  }
}

// Rango de IPs de Cloudflare (para detectar si usa CF incluso bloqueado)
const CLOUDFLARE_IP_RANGES = [
  '104.16.0.0/12',    // Rango principal de Cloudflare
  '172.64.0.0/13',    // Rango adicional
  '172.80.0.0/13',    // Rango adicional
  '2400:cb00::/32',   // IPv6
];

// Función para verificar si una IP pertenece a Cloudflare
function isCloudflareIP(ip) {
  // Lista de IPs conocidas de Cloudflare (de la API de hayahora.futbol)
  const cloudflareIPs = [
    '104.16.0.0/12',
    '104.17.0.0/16',
    '104.21.0.0/16',
    '172.64.0.0/13',
    '172.66.0.0/16',
    '172.67.0.0/16',
    '188.114.96.0/20',
    '198.41.128.0/17',
  ];

  // Convertir IP a número para comparación de rangos
  const [a, b, c, d] = ip.split('.').map(Number);
  const ipNum = (a << 24) + (b << 16) + (c << 8) + d;

  // Verificar rangos conocidos de Cloudflare
  if ((a >= 104 && a <= 104 && b >= 16 && b <= 31) ||
      (a === 172 && b >= 64 && b <= 71) ||
      (a === 188 && b === 114 && c >= 96 && c <= 111)) {
    return true;
  }

  return false;
}

// Función para resolver un dominio via API DNS pública
async function resolveDomainViaAPI(domain) {
  let resolvedIP = null;

  // Intentar con Google DNS API primero
  try {
    const response = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`);
    if (response.ok) {
      const data = await response.json();
      if (data.Answer && data.Answer.length > 0) {
        // Obtener la primera respuesta de tipo A (IPv4)
        const aRecord = data.Answer.find(record => record.type === 1);
        if (aRecord) {
          resolvedIP = aRecord.data;
        }
      }
    }
  } catch (error) {
    console.warn("⚠️ Error con Google DNS API:", error);
  }

  // Fallback: Intentar con Cloudflare DNS API
  if (!resolvedIP) {
    try {
      const response = await fetch(`https://1.1.1.1/dns-query?name=${encodeURIComponent(domain)}&type=A`, {
        headers: { 'Accept': 'application/dns-json' }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.Answer && data.Answer.length > 0) {
          // Obtener la primera respuesta de tipo A (IPv4)
          const aRecord = data.Answer.find(record => record.type === 1);
          if (aRecord) {
            resolvedIP = aRecord.data;
          }
        }
      }
    } catch (error) {
      console.warn("⚠️ Error con Cloudflare DNS API:", error);
    }
  }

  // Fallback: Intentar con quad9 DNS API
  if (!resolvedIP) {
    try {
      const response = await fetch(`https://dns.quad9.net/dns-query?name=${encodeURIComponent(domain)}&type=A`, {
        headers: { 'Accept': 'application/dns-json' }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.Answer && data.Answer.length > 0) {
          // Obtener la primera respuesta de tipo A (IPv4)
          const aRecord = data.Answer.find(record => record.type === 1);
          if (aRecord) {
            resolvedIP = aRecord.data;
          }
        }
      }
    } catch (error) {
      console.warn("⚠️ Error con Quad9 DNS API:", error);
    }
  }

  if (!resolvedIP) {
    console.error("❌ No se pudo resolver el dominio:", domain);
    return null;
  }

  // Detectar si la IP pertenece a Cloudflare
  if (isCloudflareIP(resolvedIP)) {
    console.log("☁️ IP de Cloudflare detectada:", resolvedIP);
  }

  return resolvedIP;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabStates[tabId];
  chrome.storage.local.remove(tabId.toString());
});