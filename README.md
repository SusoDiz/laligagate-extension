# 🛡️ #LaLigaGate: Detector de bloqueos

![Version](https://img.shields.io/badge/version-1.0-blue) ![License](https://img.shields.io/badge/license-MIT-green)

Herramienta de análisis de red para navegadores basada en Chromium. Detecta infraestructura de Cloudflare y verifica si el dominio o IP visitado se encuentra en listas públicas de bloqueo técnico.

## 🚀 Funcionalidades

* **⚡ Detector de Cloudflare:** Analiza las cabeceras HTTP (`Server`, `CF-Ray`) para identificar si el sitio web usa la red de Cloudflare.
* **⚠️ Monitor de Bloqueos:** Consulta automáticamente la API pública de [hayahora.futbol](https://hayahora.futbol) para comprobar si la IP o el dominio actual aparecen en el historial de bloqueos.
* **🚦 Semáforo de Estado:**
    * ⚪ **Gris:** Web normal / No listada.
    * 🟠 **Naranja:** Web usando Cloudflare.
    * 🔴 **Rojo:** Web listada en historial de bloqueos (Potencialmente afectada).
* **🔒 Privacidad:** Todo el análisis se realiza localmente. No se envían datos de navegación a servidores externos.

## 📥 Instalación

### Desde la Chrome Web Store
*(Enlace pendiente de aprobación)*

### Instalación Manual (Modo Desarrollador)
Si quieres probar la última versión del código o auditarlo:

1.  Descarga este repositorio (botón `Code` > `Download ZIP`) y descomprímelo.
2.  Abre tu navegador (Chrome, Edge, Brave).
3.  Ve a `chrome://extensions/`.
4.  Activa el **"Modo de desarrollador"** (esquina superior derecha).
5.  Haz clic en **"Cargar descomprimida"** (Load unpacked).
6.  Selecciona la carpeta donde has descomprimido los archivos.

## 🛠️ Tecnologías

* JavaScript (ES6)
* Manifest V3
* Chrome WebRequest API

## 📄 Créditos y Datos

Esta extensión es un proyecto independiente desarrollado por **SusoDiz**.
Los datos de bloqueos se obtienen de la API pública y abierta del proyecto **hayahora.futbol**.

## ⚖️ Aviso Legal

Esta herramienta tiene fines únicamente informativos y técnicos de análisis de red. No está afiliada a "LaLiga", "Cloudflare" ni a ningún operador de telefonía. El término "#LaLigaGate" se utiliza como referencia al movimiento social de transparencia digital.
