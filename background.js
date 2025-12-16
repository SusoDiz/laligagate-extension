let tabStates = {};
let cachedBlockList = { ips: new Set(), lastUpdate: 0, fullData: {} }; // Incluye datos completos
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
      const fullData = {}; // Guardar datos completos por IP+ISP
      
      if (data.data && Array.isArray(data.data)) {
        data.data.forEach(entry => {
          if (entry.ip) {
            const ipLower = entry.ip.toLowerCase();
            ips.add(ipLower);
            
            // Guardar datos completos: key = IP, value = array de registros por ISP
            if (!fullData[ipLower]) {
              fullData[ipLower] = [];
            }
            fullData[ipLower].push({
              isp: entry.isp,
              description: entry.description,
              stateChanges: entry.stateChanges
            });
          }
        });
      }
      cachedBlockList = {
        ips: ips,
        fullData: fullData,
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
  // Procesar cualquier cambio de pestaña, especialmente cuando se carga
  if (changeInfo.status === 'complete') {
    
    if (!tabStates[tabId]) resetTabState(tabId);
    
    // Si no es una URL HTTP válida (es about:blank, chrome://, etc.), usar icono por defecto
    if (!tab.url || !tab.url.startsWith('http')) {
      console.log("ℹ️ URL no procesable:", tab.url);
      chrome.action.setIcon({ tabId: tabId, path: "cf-off.png" });
      chrome.storage.local.set({ [tabId]: tabStates[tabId] });
      return;
    }

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

    // Analizar el nuevo objeto de estado con timestamps
    if (blockStatus.status === 'blocked') {
      // 🔴 ROJO: Actualmente bloqueada por al menos un ISP
      finalIcon = "cf-blocked.png";
      console.log("🔴 Icono ROJO: Bloqueada por", blockStatus.details.blockedByISPs.map(b => b.isp).join(', '));
    } else if (blockStatus.status === 'listed') {
      // 🟡 AMARILLO: Listada pero no actualmente bloqueada
      // (fue bloqueada en el pasado o solo algunos ISPs la tenían)
      finalIcon = "cf-warning.png"; // Icono amarillo para advertencia histórica
      console.log("🟡 Icono AMARILLO: Listada pero no actualmente bloqueada. ISPs:", 
        blockStatus.details.listedButNotBlockedISPs.map(b => b.isp).join(', '));
    } else if (cloudflareDetected) {
      // 💙 AZUL: Usa Cloudflare pero no está bloqueada
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

// Establecer icono por defecto cuando se crea una nueva pestaña
chrome.tabs.onCreated.addListener((tab) => {
  resetTabState(tab.id);
  chrome.action.setIcon({ tabId: tab.id, path: "cf-off.png" });
});

// Función mejorada que analiza el estado actual y quién está bloqueando
function checkBlockStatus(currentUrl, ipAddress) {
  if (!cachedBlockList.ips || cachedBlockList.ips.size === 0) {
    console.log("⚠️ Lista de bloqueos vacía para URL:", currentUrl);
    return { status: 'clean', details: null };
  }

  try {
    const urlObj = new URL(currentUrl);
    const domain = urlObj.hostname.replace(/^www\./, '').toLowerCase();

    // BÚSQUEDA EFICIENTE: Comprobar la IP de forma precisa
    if (!ipAddress) {
      console.log("✅ Dominio:", domain, "IP: N/A", "Estado: LIMPIO");
      return { status: 'clean', details: null };
    }

    const ipLower = ipAddress.toLowerCase();
    if (!cachedBlockList.ips.has(ipLower)) {
      console.log("✅ Dominio:", domain, "IP:", ipLower, "Estado: LIMPIO");
      return { status: 'clean', details: null };
    }

    // La IP está en la lista, ahora analizamos el estado actual por ISP
    const ipRecords = cachedBlockList.fullData[ipLower] || [];
    
    if (ipRecords.length === 0) {
      console.log("⚠️ IP encontrada pero sin datos:", ipLower);
      return { status: 'listed', details: null };
    }

    // Analizar el último estado para cada ISP
    const blockedByISPs = [];
    const listedButNotBlockedISPs = [];

    ipRecords.forEach(record => {
      if (!record.stateChanges || record.stateChanges.length === 0) {
        return;
      }

      const lastChange = record.stateChanges[record.stateChanges.length - 1];
      const isCurrentlyBlocked = lastChange.state === true;
      const lastTimestamp = new Date(lastChange.timestamp);

      if (isCurrentlyBlocked) {
        blockedByISPs.push({
          isp: record.isp,
          timestamp: lastTimestamp,
          timestampStr: lastChange.timestamp,
          description: record.description
        });
      } else {
        listedButNotBlockedISPs.push({
          isp: record.isp,
          timestamp: lastTimestamp,
          timestampStr: lastChange.timestamp,
          description: record.description
        });
      }
    });

    // Determinar el estado final
    if (blockedByISPs.length > 0) {
      // Algún ISP la está bloqueando ahora
      const blockedInfo = blockedByISPs.map(b => 
        `${b.isp} (${b.timestamp.toLocaleString('es-ES')})`
      ).join(', ');
      
      console.log("🔴 IP BLOQUEADA:", ipLower, "para dominio:", domain);
      console.log("   Bloqueada por:", blockedInfo);
      
      return {
        status: 'blocked',
        details: {
          ip: ipLower,
          domain: domain,
          blockedByISPs: blockedByISPs,
          listedButNotBlockedISPs: listedButNotBlockedISPs
        }
      };
    } else {
      // Está listada pero no está bloqueada actualmente
      console.log("⚠️ IP LISTADA pero NO bloqueada actualmente:", ipLower);
      
      return {
        status: 'listed',
        details: {
          ip: ipLower,
          domain: domain,
          listedButNotBlockedISPs: listedButNotBlockedISPs,
          lastBlockedAt: listedButNotBlockedISPs.length > 0 ? listedButNotBlockedISPs[0].timestamp : null
        }
      };
    }

  } catch (error) {
    console.error("Error comprobando bloqueo:", error);
    return { status: 'clean', details: null };
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