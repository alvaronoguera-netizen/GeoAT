# Geo AT — versión actualizada del prototipo

Esta versión conserva la estructura del prototipo GeoAT anterior y aplica únicamente los cambios solicitados:

1. El encabezado utiliza el logo proporcionado de CUNORI / Administración de Tierras y el nombre visible es **Geo AT**.
2. Se evita la repetición horizontal del mundo en las capas base de Leaflet mediante `noWrap`, `worldCopyJump: false` y límites del mapa.
3. El flujo de carga se reorganiza a 8 pasos:
   - Paso 1: Cargar capa
   - Paso 2: Identificación
   - Paso 3: Categorías
   - Paso 4: Accesos
   - Paso 5: Extensión
   - Paso 6: Contacto
   - Paso 7: Enlace
   - Paso 8: Historial
4. Se eliminan de la interfaz y del código las estadísticas de valores y la comparación de valores.
5. Se conservan las herramientas de visualización, información, descarga, dibujo, edición y medición.

## Estructura

```text
GeoAT_ACTUALIZADO/
├── index.html
├── styles.css
├── app.js
├── README.md
├── .nojekyll
├── INSTRUCCIONES_PRUEBA.txt
├── assets/
│   └── logo-cunori-at.png
└── data/
    ├── layers.json
    ├── demo-zonas.geojson
    └── demo-puntos.geojson
```

## Prueba

Usa Visual Studio Code + Live Server y abre `index.html`.

Esta etapa sigue siendo el frontend. La conexión con backend Java, Google Drive y Google Sheets debe integrarse después sobre el backend real del proyecto.
