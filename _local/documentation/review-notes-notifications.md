# Avisos de Review Notes

## Recuperar texto añadido fuera del JSON

Bookings Manager detecta un documento JSON válido seguido de texto manual. Conserva el documento completo y añade el bloque posterior como una nota `Imported text`, sin autor identificado ni fecha. Elimina únicamente separadores iniciales formados por guiones; conserva saltos de línea y separadores internos. Si el bloque repite una nota existente, se conserva igualmente como nota independiente.

La vista Communication muestra el contenido recuperado. Al abrir **Add / Manage notes**, el widget guarda automáticamente la reparación; también vuelve a comprobar el campo antes de guardar una nota por si se añadió texto mientras el editor estaba abierto. Las aperturas posteriores no duplican la importación. Un JSON roto o de una versión desconocida sigue bloqueado para evitar perder historial.

Las notas importadas que contienen HTML del editor de CRM se muestran y se abren para editar como texto legible: se convierten saltos de línea y párrafos, se decodifican entidades y se elimina el separador inicial. También se aplica a notas ya importadas. El HTML original se conserva en el campo hasta que se edite y guarde esa nota; al visualizarlo no se ejecuta ni se inserta en la página. Este ajuste solo requiere publicar el widget, sin cambiar la función Deluge. Prueba de navegador: `node tests/review-notes-html-browser.cjs` con `PLAYWRIGHT_MODULE` configurado.

**Instalación necesaria antes de publicar este widget:** crear una función Standalone con nombre API `reviewnotes_repair`, retorno String y cuatro argumentos String: `bookingId`, `actingUserId`, `expectedNotes`, `jsonPrefix`. Fuente: [reviewNotes_repair.dg](../integrations/crm/source/reviewNotes_repair.dg). Usa la conexión existente `crm_oauth_connection`, con los mismos permisos de lectura/actualización de Deals que el guardado habitual, y debe poder invocarse desde el SDK del widget.

La función reconstruye las notas desde el campo real de CRM, verifica Owner/Guest Relations, compara el valor leído y usa `If-Unmodified-Since`. La reparación no envía correos ni cambia `GR_Review_Pending`; las altas, ediciones y borrados posteriores mantienen sus avisos habituales. Si falla la reparación, se muestra el error y no se continúa con el guardado de la nota. No requiere modificar `reviewnotes_saveandnotify` ni crear un workflow.

Verificación local: `node --test tests/review-notes-recovery.test.cjs tests/booking-communication.test.cjs tests/review-notes-save.test.cjs`. La ejecución de Deluge debe comprobarse en Zoho con una reserva de prueba: importar texto, reabrir sin duplicarlo, guardar una respuesta y verificar un conflicto entre sesiones. Este cambio no se publica automáticamente en CRM y no añade recuperación automática a reconfirmationManager.

Ambos widgets llaman a `reviewnotes_saveandnotify` al añadir, editar o eliminar una nota. La función guarda `Deals.Review_Notes` y después envía un correo al otro responsable. El destinatario se obtiene de los usuarios CRM asociados a `Owner` y `Guest_Relations_Rep` (ambos son campos de usuario; no son IDs de `User_Relationships`).

El envío utiliza `sendmail`, igual que `email_dailyReconfirmation`, desde `crmadmin@madeforspainandportugal.com` al correo corporativo del destinatario. Se recibe en Outlook; no requiere Microsoft Graph, no abre un borrador y no envía desde el buzón personal de Outlook. Reply-To identifica al usuario que ha realizado el cambio. Las respuestas por email no se importan a Review Notes.

## Instalación

1. Crear **una sola función Standalone**, retorno `string`, usando [reviewNotes_saveAndNotify.dg](../integrations/crm/source/reviewNotes_saveAndNotify.dg). Nombre API: **`reviewnotes_saveandnotify`**. Argumentos String: `bookingId`, `actingUserId`, `expectedNotes`, `notesJson`.
2. Configurar la conexión existente `crm_oauth_connection` con actualización de Deals. Las tareas `zoho.crm.getRecordById` y `zoho.crm.searchRecords` deben tener acceso de lectura a Deals/Review_Notes y User_Relationships respectivamente. No se utiliza la API de usuarios ni se necesita `ZohoCRM.users.READ` para esta función. El remitente `crmadmin@madeforspainandportugal.com` debe estar autorizado, como para el informe diario. La función usa CRM EU y el enlace de la organización `20093299576`.
3. Habilitar la invocación mediante el SDK de widgets para los perfiles de ambos equipos. La función utiliza el `actingUserId` enviado por el widget, sin compararlo con `zoho.loginuserid`. Resuelve al editor y al destinatario buscando `User_Relationships.User_ID` y obtiene `Email` y `Full_Name`. Cada usuario debe tener un único registro con `Status = Active` y correo informado. Se mantiene la comprobación del ID recibido contra Owner/Guest Relations del booking.
4. Publicar los dos widgets **después** de instalar la función. Los archivos JavaScript y Deluge compartidos se incluyen en los dos repositorios con contenido idéntico. No hay que crear un workflow adicional para Review Notes.
5. Probar en una reserva de prueba con los dos responsables: alta desde Guest Relations → Owner; edición desde Owner → Guest Relations; borrado → otro responsable. Confirmar recepción real y apariencia en Outlook.

La creación de estos archivos no publica la función ni los widgets en Zoho. No se han enviado correos reales durante el desarrollo.

## Comportamiento y errores

- El widget envía el ID del usuario conectado, incluso cuando se consulta el espacio de trabajo de otra persona. La función utiliza ese ID sin validarlo contra la sesión Deluge. El autor original de la nota no determina el destinatario. Los nombres y correos se leen de User_Relationships.
- Solo Owner y Guest Relations del booking pueden guardar por esta función. Si ambos son la misma persona, se guarda sin autoaviso. Si falta el otro responsable o su correo activo, se informa antes de guardar.
- Se compara el contenido anterior y se utiliza `If-Unmodified-Since` en la actualización CRM. Un conflicto requiere reabrir las notas; nunca se reintenta sobrescribiendo a ciegas.
- Un guardado sin cambios en texto/formato no envía correo. Se admite una operación sobre una nota por llamada. La conversión del texto histórico conserva su contenido; los dos widgets pueden leer ambos formatos históricos.
- El correo reproduce la paleta azul, Arial y cabecera de `email_dailyReconfirmation`, con tablas y estilos inline para Outlook. El contenido de la nota se escapa como texto y conserva saltos de línea. Incluye autor del cambio, referencia y booking. Se ha retirado el enlace al registro nativo de CRM para evitar mostrar el JSON de Review Notes. [Vista previa con datos ficticios](review-notes-email-preview.html).
- Si se guarda la nota y falla el envío, se devuelve `saved: true`, `notificationStatus: failed` y una advertencia visible. No se revierte la nota ni se invita a repetir la edición.
- Esta versión no incorpora una cola persistente ni reintentos automáticos de correo. Una interrupción entre guardado y envío puede dejar el aviso sin enviar; `sendmail` tampoco confirma recepción en Outlook. Repetir un guardado cuyo contenido ya existe no reenvía. Para garantía de entrega/reintentos se necesita un registro persistente de eventos y un proceso de envío separado; no debe simularse reenviando al editar otra vez.
- `Trigger: []` evita workflows adicionales durante el guardado centralizado. Si ya existe un workflow que avisa de Review Notes, no debe mantenerse como segundo mecanismo de envío.

## Verificación local

Desde reconfirmationManager: `node --test tests/itinerary-review-actions.test.js tests/review-notes-save.test.js`.
Desde bookingsManager: `node --test tests/booking-communication.test.cjs tests/review-notes-save.test.cjs`.

Las pruebas locales verifican el contrato de los widgets, errores, compatibilidad y selección de identidad. No ejecutan Deluge ni verifican correo real. Validar sintaxis, contexto de usuario, permisos y entrega en CRM antes de publicar los widgets.

Referencia de concurrencia: [Zoho CRM Update Records](https://www.zoho.com/crm/developer/docs/api/v8/update-records.html).

## Diagn?stico del env?o

Instalar la funci?n Deluge actualizada y publicar ambos ZIPs para ver los mensajes nuevos. Al guardar, el panel muestra si Zoho complet? el env?o (incluido destinatario), lo omiti? por usuario id?ntico/sin cambios o fall?. Un estado ausente tambi?n genera una advertencia. Completar `sendmail` no confirma entrega a Outlook.

La respuesta de la funci?n incluye `diagnostics`: versi?n, paso (`phase`), booking, editor, Owner, Guest Relations, destinatario, correo, remitente y error si lo hay. Se registra en los logs de ejecuci?n de CRM con el prefijo `Review Notes notification`. En la consola del widget se puede filtrar por `[Review Notes notification]`. No se registran los cuerpos de las notas o del correo.

Si vuelve a fallar, copiar el aviso visible y la entrada de diagn?stico. Si el estado es `sent` y el paso es `sendmail_completed`, revisar el destinatario indicado y el seguimiento/cuarentena del correo; ese resultado solo confirma que Zoho termin? la instrucci?n de env?o. No repetir una edici?n para intentar reenviar.

El correo al Owner incluye un enlace a `https://crm.zoho.eu/crm/org20093299576/tab/WebTab3` con `widgetparams` (JSON codificado: `bookingId` como String y `view: review-notes`). El widget registra PageLoad antes de inicializar el SDK, espera al arranque y abre el booking por ID, la pesta?a Communication y el editor de Review Notes. No depende de los estados ni del filtro de la cola; se aplican los permisos CRM del usuario. Los correos a Guest Relations siguen sin enlace nativo.

Para activar: actualizar la funci?n en CRM y publicar el ZIP de Bookings Manager. Probar un enlace desde Outlook en una nueva pesta?a autenticada, incluida una reserva fuera del filtro de la cola. La apertura completa por URL requiere esta comprobaci?n en CRM: las pruebas locales verifican el contenido del enlace y el manejo de PageLoad, pero no el transporte del par?metro por el host Zoho.

Referencia SDK: https://help.zwidgets.com/help/v1.0.6/ZOHO.CRM.UI.WebTab.html y https://github.com/zoho/embeddedApp-js-sdk (PageLoad se registra antes de init).
