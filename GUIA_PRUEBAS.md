# 🧪 Guía de pruebas — Enmienda v0.1.0

> **Objetivo:** Validar que el flujo editorial completo funciona: escribir → versionar → comparar → merge selectivo.  
> **Tiempo estimado:** 15-20 minutos.  
> **Qué necesitas:** el PC donde tengas Rust + Node.js instalados.

---

## 1. Requisitos previos

```bash
# Verifica que tienes todo
rustc --version   # ≥ 1.77
node --version    # ≥ 18
npm --version     # ≥ 9
```

Si te falta Rust:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Cerrar y reabrir terminal, o: source "$HOME/.cargo/env"
```

Dependencias de sistema en Ubuntu/Debian (ya las tienes si compilaste antes):
```bash
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev
```

---

## 2. Clonar e instalar

```bash
git clone https://github.com/LibertoBaltasar/enmienda.git
cd enmienda
npm install
```

---

## 3. Arrancar la app

```bash
cargo tauri dev
```

Esto tarda ~30-60s la primera vez (compila Rust). Verás una ventana de 1200×800 con fondo oscuro y el editor vacío.

> ⚠️ Si falla con error de webkit, revisa que instalaste `libwebkit2gtk-4.1-dev`.

---

## 4. Pruebas del flujo editorial

### PRUEBA A: Escribir, versionar, restaurar

| Paso | Acción | Qué debería pasar |
|------|--------|-------------------|
| A1 | Escribe 3 párrafos en el editor (inventa cualquier texto) | El texto aparece con syntax Markdown, word count se actualiza |
| A2 | Pulsa **Ctrl+Shift+S** (o botón 📸) | Te pide etiqueta opcional. Ponle "Versión 1" |
| A3 | Mira la barra lateral (botón 🕐 Historial) | Aparece una tarjeta con "Versión 1", timestamp y nº de palabras |
| A4 | Borra un párrafo entero y añade uno nuevo | El texto cambia |
| A5 | Crea otra instantánea "Versión 2" | Nueva tarjeta en el historial |
| A6 | En el historial, pulsa **↩ Restaurar** en "Versión 1" | Pide confirmación → el editor vuelve al texto original de la Versión 1 |
| A7 | Mira el historial otra vez | Aparece una instantánea automática "Auto: antes de restaurar" |

**✅ ¿Pasó todo?** El sistema de versiones funciona.

---

### PRUEBA B: Comparar y hacer merge por párrafos (LA PRUEBA CLAVE)

| Paso | Acción | Qué debería pasar |
|------|--------|-------------------|
| B1 | Restaura "Versión 2" desde el historial (si no está, créala con 3-4 párrafos) | Editor muestra el texto |
| B2 | **Edita solo 2 párrafos**: cambia frases dentro de ellos. Añade 1 párrafo nuevo. Borra 1 párrafo | Tienes cambios mezclados: 2 modificados, 1 añadido, 1 eliminado |
| B3 | Crea instantánea "Versión 3" | Guardada |
| B4 | Restaura "Versión 2" otra vez | El editor vuelve a la Versión 2 |
| B5 | En historial, pulsa **🔍 Comparar** en "Versión 3" | Se abre panel inferior mostrando cada párrafo coloreado |
| B6 | Verifica los colores: | 🟢 verde = añadido, 🔴 rojo = eliminado, 🔴 rosa = modificado, gris = sin cambios |
| B7 | En el panel de merge, pulsa **✓ Aceptar** en UN párrafo modificado | Ese párrafo se actualiza en el editor. El panel lo marca como resuelto |
| B8 | Pulsa **✗ Rechazar** en otro párrafo | Ese cambio se descarta (se queda la versión actual) |
| B9 | Pulsa **✓ Aceptar todo** | Se aplican todos los cambios restantes de golpe |
| B10 | Cierra el panel de merge | El editor ahora tiene la mezcla exacta que elegiste |

**✅ ¿Pasó todo?** El merge granular por párrafos funciona. Esto es el core del producto.

---

### PRUEBA C: Persistencia (supervivencia a cierre)

| Paso | Acción | Qué debería pasar |
|------|--------|-------------------|
| C1 | Escribe un texto reconocible ("PRUEBA PERSISTENCIA 123") | Visible en el editor |
| C2 | Cierra la ventana de la app (la X) | Se cierra |
| C3 | Vuelve a lanzar `cargo tauri dev` | La app se abre |
| C4 | Mira el editor | Debe mostrar "PRUEBA PERSISTENCIA 123" |
| C5 | Abre el historial | Las instantáneas anteriores siguen ahí |

**✅ ¿Pasó todo?** IndexedDB funciona, los datos sobreviven a cierres.

---

### PRUEBA D: Archivos .md (abrir/guardar)

| Paso | Acción | Qué debería pasar |
|------|--------|-------------------|
| D1 | Pulsa **Ctrl+O** (o 📂 Abrir) | Se abre diálogo nativo del sistema para elegir archivo |
| D2 | Selecciona un archivo .md que tengas | El contenido se carga en el editor. La barra superior muestra el nombre del archivo |
| D3 | Edita algo en el texto | Cambios visibles |
| D4 | Pulsa **Ctrl+S** (o 💾 Guardar) | Guarda sobre el mismo archivo. Botón 💾 parpadea en rojo |
| D5 | Abre el archivo con otro editor (VS Code, gedit) | Los cambios que hiciste están escritos en disco |
| D6 | Cierra Enmienda, vuelve a abrirla, pulsa Ctrl+O → mismo archivo | El contenido es el mismo que guardaste (incluyendo cambios) |

**✅ ¿Pasó todo?** Lectura/escritura de archivos reales funciona.

---

### PRUEBA E: Atajos de teclado

| Atajo | Debería |
|-------|---------|
| `Ctrl+O` | Abrir diálogo de archivo |
| `Ctrl+S` | Guardar archivo actual |
| `Ctrl+Shift+S` | Crear instantánea |

**✅ ¿Funcionan los 3?**

---

### PRUEBA F: Casos límite

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| F1 | Crea instantánea con el editor vacío (0 palabras) | Se crea, word count = 0 |
| F2 | Compara dos instantáneas idénticas | Todos los párrafos aparecen como "sin cambios" (gris) |
| F3 | Elimina TODAS las instantáneas del historial | Lista vacía con mensaje "Sin instantáneas todavía" |
| F4 | Restaura una instantánea y luego deshace (no hay botón undo) | Se creó "Auto: antes de restaurar", puedes volver a ella |

---

## 5. Checklist final

- [ ] El editor arranca y puedo escribir Markdown
- [ ] Las instantáneas se crean, listan, comparan, restauran y eliminan
- [ ] El merge por párrafos funciona: aceptar/rechazar cambios individuales
- [ ] El texto sobrevive a cerrar y reabrir la app
- [ ] Puedo abrir archivos .md reales y guardar cambios
- [ ] Los atajos de teclado funcionan
- [ ] Los casos límite no rompen nada

---

## 6. Problemas comunes

| Problema | Solución |
|----------|----------|
| `cargo tauri dev` falla con error de linking | `sudo apt install libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev` |
| La ventana se abre en blanco | Espera 5s — Vite tarda en arrancar. Si no, revisa la terminal por errores |
| "Abrir archivos solo funciona en la app de escritorio" | Normal si pruebas en navegador (`npm run dev`). Usa `cargo tauri dev` |
| El botón guardar no hace nada | No has abierto un archivo primero. Usa Ctrl+O para elegir uno |
| Error "Segmentation fault" al abrir diálogo | Puede ser bug de Tauri en Wayland. Prueba con `WEBKIT_DISABLE_COMPOSITING_MODE=1 cargo tauri dev` |

---

## 7. Reportar resultados

Cuando termines, dime:

1. ✅ / ❌ de cada prueba (A, B, C, D, E, F)
2. Lo que **sí** funciona bien
3. Lo que **falla o es confuso** (con captura si puedes)
4. Lo que **echas en falta** como editor/corrector

Con eso itero y pulimos.
