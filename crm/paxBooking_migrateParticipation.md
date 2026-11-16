# PAX Booking - Migrate Participation

Función creada y compilada en CRM el 29/10/2026. API: `paxbooking_migrateparticipation`.
Categoría Standalone. ID: `616617000176735281`. Sin programación ni ejecución automática.
El código publicado se ha vuelto a leer y coincide con el archivo `.dg`, salvo formato.
La migración no se ha ejecutado, ni siquiera en modo simulación dentro de Deluge.

## Reglas acordadas

- Actualiza exclusivamente `PAX_X_Bookings`.
- `Participation_Status = Active`, incluso si existía otro estado.
- `Source_System = Ezus` si `Bookings.Ezus_Project_ID`, tras quitar espacios exteriores, no está vacío; en caso contrario, `TP`.
- `Lead_Passenger = PAX.Lead_Pax`, tanto true como false, también en todos los viajes de los PAX compartidos.
- Envía únicamente los campos cuyo valor sea distinto. Una segunda pasada con las mismas fuentes no vuelve a escribir esos valores.
- No modifica PAX, Bookings, notas, solicitudes, referencias, servicios ni asociaciones.
- La opción TP ya está añadida y verificada en Source System. Las opciones anteriores se conservaron.

## Primera simulación

Busca **PAX Booking - Migrate Participation** en Configuración → Funciones y utiliza su ejecución de prueba con:

| Argumento | Valor |
| --- | --- |
| dryRun | true |
| afterId | 0 |
| throughId | vacío |
| batchSize | 2000 |

Es una simulación de hasta 2.000 relaciones, no un recuento global. Revisa `success`, `scanned`, `wouldUpdate`, `unchanged`, `ezus`, `tp`, `leadTrue` y `sample`.
La muestra contiene hasta 20 relaciones con valores anteriores y cambios propuestos; no es un registro completo para deshacer cambios.
Guarda el `throughId` devuelto: es el ID máximo que delimita esta migración.

## Aplicar y continuar

Para aplicar el lote simulado, conserva **afterId=0**, el `throughId` recibido y `batchSize=2000`, cambiando solo `dryRun` a **false**.
No utilices el nextCursor de la simulación para iniciar la escritura: saltarías ese primer lote.

Después de una ejecución real con `success=true`:

- Si `done=false`, repite con `afterId=nextCursor`, el mismo `throughId` y `dryRun=false`.
- Si `done=true`, el recorrido ha terminado para las relaciones accesibles a ese usuario dentro de ese límite.
- Puedes reducir batchSize a cualquier entero entre 1 y 2000. Cada petición de escritura contiene como máximo 100 registros.

Si `success=false`, **no avances afterId**. Conserva los parámetros originales del lote, corrige el error y repite.
Puede haber escrituras parciales: `updated` cuenta solo respuestas SUCCESS confirmadas. Si una petición se interrumpe, puede haberse aplicado sin confirmación; la repetición vuelve a leer las fuentes y omite los valores que ya coincidan.
Si la ejecución termina sin devolver respuesta, repite también el mismo cursor y límite originales.

No ejecutes lotes en paralelo. Evita editar estos tres campos o sincronizar pasajeros durante el recorrido.
throughId fija el conjunto por ID, no congela los valores de PAX/Booking: cada lote lee los valores vigentes.
Volver a ejecutar esta función después de empezar la gestión manual sobrescribiría los tres campos según estas reglas.

## Conexión y alcance de la validación

Usa la conexión existente `crm_oauth_connection` y el centro de datos EU.
El usuario/conexión necesita lectura COQL, lectura de campos y acceso a PAX y Deals, más actualización de PAX_X_Bookings.
La función comprueba Active/Ezus/TP en la metadata antes de escribir y detiene el lote si no puede leer PAX, Booking o Lead_Pax.
Las escrituras incluyen `trigger: []` y exclusión de cadences. No crea ni envía comunicaciones.

Validación realizada:

- Consulta COQL con los dos lookups y los alias comprobada en CRM en modo lectura.
- Función aceptada por el compilador de Zoho, activa y sin borrador; código publicado contrastado.
- 9 pruebas locales del flujo Deluge con respuestas simuladas: dry run, PAX compartidos, ambos booleanos, lotes, repetición, errores parciales, permisos/metadatos, cursores e IDs de 18 dígitos.
- Pendiente: ejecución real de dryRun en CRM para comprobar la conexión y sus permisos en ese contexto. La prueba local no acredita esa ejecución.

Comando local: `node --test tests/pax-booking-migration.test.cjs`.

Referencias oficiales:

- https://www.zoho.com/crm/developer/docs/api/v8/update-records.html
- https://www.zoho.com/crm/developer/docs/api/v8/COQL-Limitations.html

Tras la migración sigue pendiente adaptar la sincronización de Ezus, las plantillas, los widgets y el reporte del Ministerio para utilizar los datos de la relación. No retires todavía Lead_Pax de PAX.
