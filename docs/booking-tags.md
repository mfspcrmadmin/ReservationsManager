# Etiquetas personales de bookings

Crear estos campos en Zoho CRM (el módulo Bookings utiliza el nombre API `Deals`):

| Módulo API | Etiqueta sugerida | Nombre API exacto | Tipo |
| --- | --- | --- | --- |
| `User_Relationships` | Booking Tag Catalog JSON | `Booking_Tag_Catalog_JSON` | Texto multilínea, texto plano, capacidad grande |
| `Deals` | Booking Tags JSON | `Booking_Tags_JSON` | Texto multilínea, texto plano, capacidad grande |

Dejar ambos vacíos. No usar texto enriquecido, fórmulas ni valores predeterminados.
Dar lectura y edición de los campos a los perfiles que usarán las etiquetas; también necesitan editar su registro de User Relationships y los bookings correspondientes. El widget limita sus escrituras de catálogo al registro personal identificado por ID de usuario o email, sin recurrir al nombre. Si hay varias coincidencias, bloquea la gestión.

## Formato

Catálogo de cada User Relationships:

```json
{"version":1,"tags":[{"id":"uuid","name":"VIP","color":"#c4b5fd"}]}
```

Asignaciones de un booking, por ID de registro de User Relationships (no por nombre ni email):

```json
{"version":1,"users":{"123456789":["uuid"]}}
```

Los IDs de etiquetas no cambian al editar el nombre o color. Borrar una etiqueta elimina su definición del catálogo: desaparece de todos los bookings sin actualizar masivamente esos registros. Sus referencias antiguas se ignoran y se limpian cuando el usuario vuelve a guardar las etiquetas de ese booking. Crear otra etiqueta con el mismo nombre genera un ID nuevo y no recupera asignaciones antiguas.

## Uso

- `+ Tags` en cada fila de Queue y en el detalle Booking abre el mismo editor, también en Focus y sobre la Queue expandida.
- Crear, editar nombre/color y borrar afectan al catálogo personal y se guardan con sus propios botones.
- Seleccionar etiquetas y pulsar `Apply to booking` guarda las asignaciones. Desmarcar permite quitarlas del viaje.
- `Add suggested tags` añade AGENT, FLAMENCO, HEIGHT/WEIGHT, MEET AND GREET, MENUS, PARQUE GÜELL, RESTAURANTES, SHOREX, STUDYTOUR, TICKETS, TOROS y VIP sin asignarlas al booking; evita duplicar los nombres existentes.
- Los colores y nombres se muestran como chips. Queue muestra dos chips y el número de etiquetas adicionales.
- Las etiquetas pertenecen a cada usuario en la interfaz; los campos JSON no aportan confidencialidad frente a usuarios con acceso CRM al registro.

## Guardado y límites

El widget relee el registro antes de guardar, mezcla las asignaciones del usuario con las del resto y verifica el campo después de escribirlo. No muestra éxito si CRM rechaza el cambio o la lectura de comprobación no coincide. Los cambios de etiquetas no ejecutan workflows (`Trigger: []`).

El SDK embebido usado por este widget no documenta una cabecera de actualización condicional. Por tanto, **la relectura y verificación no hacen atómicas dos escrituras simultáneas de distintos usuarios**: aún existe una pequeña ventana en la que una escritura puede sobrescribir otra. Si se necesita garantía estricta, añadir un endpoint/función CRM que use `If-Unmodified-Since` con reintentos, o cambiar a registros de asignación independientes. La implementación actual no afirma resolver ese conflicto.

Referencias: [updateRecord del SDK](https://help.zwidgets.com/help/latest/ZOHO.CRM.API.html#updateRecord), [actualización condicional de la API REST](https://www.zoho.com/crm/developer/docs/api/v8/update-records.html).

El widget limita cada JSON a 30.000 caracteres y cada nombre a 60. JSON inválido, campos no disponibles, permisos insuficientes o un usuario sin registro personal impiden guardar y muestran un mensaje. Para habilitarlo tras crear los campos, recargar el widget.

La carga inicial del catálogo se ejecuta en segundo plano y nunca retrasa la carga de Booking Queue. Las lecturas de etiquetas tienen un máximo de espera de cinco segundos; si fallan, el resto del workspace sigue disponible y se puede reintentar abriendo `+ Tags`.

La comprobación local utiliza CRM simulado; la prueba con datos reales queda pendiente de crear los campos y acceder al widget autenticado.
