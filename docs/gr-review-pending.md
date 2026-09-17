# GR Review Pending

Campo Checkbox en Deals: **GR Review Pending**, nombre API esperado **`GR_Review_Pending`**. Comprobar ese nombre y permisos de lectura/escritura antes de publicar. No se ha podido consultar la metadata actual de CRM desde este entorno.

## Funcionamiento

- Añadir o editar una nota como Booking Owner activa el checkbox, en la misma actualización que guarda `Review_Notes`. Se conserva aunque falle el envío del correo.
- Los cambios de Guest Relations no lo activan ni desactivan. Si Owner y GR son la misma persona no se genera un pendiente para sí misma. Un borrado mantiene el valor actual del checkbox; sigue aplicándose el aviso de correo existente.
- Reconfirmation Manager incorpora **Pending Notes**: bookings del Guest Relations seleccionado con el checkbox activado, sin condición de Stage. La pestaña **Itinerary Reviews** conserva sus filtros y acciones.
- **Review Notes** abre el historial con formato y permite responder. Abrirlo o responder no marca como revisado.
- **Mark as reviewed** desactiva exclusivamente el checkbox. No cambia el Stage, no borra notas y no envía correo. Solo lo puede ejecutar el GR asignado, utilizando el ID del usuario que envía el widget, como la función de guardado existente.
- Si las notas cambian desde que se cargó la lista o el historial, el marcado se rechaza y pide refrescar. La actualización también usa `If-Unmodified-Since` para detectar cambios posteriores a la lectura del servidor.
- Puede activarse manualmente desde CRM. No se modifica retroactivamente ninguna reserva existente.

## Publicación

1. Verificar el API name `GR_Review_Pending` y los permisos del campo en Deals.
2. Actualizar **`reviewnotes_saveandnotify`** con el archivo de `crm/reviewNotes_saveAndNotify.dg` del proyecto correspondiente. No cambiar sus cuatro argumentos actuales. Ambos proyectos incorporan el cambio y conservan sus otras modificaciones locales.
3. Crear una función **Standalone** con API name **`reviewnotes_markreviewed`**, retorno String, argumentos String `bookingId`, `actingUserId`, `expectedNotes`. Fuente: [reviewNotes_markReviewed.dg](../crm/reviewNotes_markReviewed.dg). Utiliza la conexión existente `crm_oauth_connection` para actualizar Deals y la lectura CRM de la función.
4. Habilitar su ejecución desde el SDK para los perfiles correspondientes y publicar el ZIP actualizado de Reconfirmation Manager. Este cambio no requiere una nueva versión del widget Bookings Manager: ya utiliza la función compartida.
5. Probar como Owner en una reserva fuera de Pending Review/FID In Review: añadir una nota, comprobar checkbox y verla como GR en Pending Notes. Responder debe conservar el pendiente. Mark as reviewed debe retirarla de la lista sin cambiar Stage. Una nota nueva del Owner vuelve a activarlo.

Las funciones no están publicadas automáticamente por guardar estos archivos. Las pruebas locales no ejecutan Deluge ni verifican permisos/metadata en CRM.
