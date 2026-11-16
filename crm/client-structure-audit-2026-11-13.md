# Estructura de clientes y contactos en Zoho CRM

Verificación del 13 de noviembre de 2026. Alcance autorizado: investigación de solo lectura y preparación. No se han creado campos o módulos ni modificado registros, funciones, automatizaciones o bookings.

La estructura acordada puede prepararse de forma aditiva. El diccionario siguiente concreta las altas, pero no debe considerarse ejecutable todavía: faltan cuotas de la organización, permisos efectivos, dependencias de workflows e informes y varias decisiones de negocio. Los nombres propuestos no aparecen entre los campos de los módulos inspeccionados ni entre los módulos devueltos; eso no reserva sus nombres ni acredita capacidad de creación.

# Evidencia actual

## Esquema y datos de Clients

Lectura completa de Accounts mediante COQL SELECT, orden por ID y paginación por último ID, en tres páginas. Los datos se mantuvieron en memoria; este informe no es un respaldo recuperable de registros. Es una lectura realizada durante un intervalo, sin aislamiento transaccional frente a cambios de otros usuarios.

| Control | Resultado |
| --- | --- |
| Clients leídos | 5.554 |
| Agent_Code vacío tras trim | 0 |
| Agent_Code repetido tras trim y comparación sin mayúsculas | 0 |
| Flag_As_Deleted true | 249 |
| Sin IATA tras trim | 2.024 |
| IATA informado que no cumple ocho dígitos tras trim | 307 |
| Grupos de IATA repetido informado | 270 |
| Grupos de nombres repetidos tras trim y comparación sin mayúsculas | 129 |
| Grupos con varios registros con Flag_As_Deleted false | 42 |
| Con Parent_Account | 1.332 |
| Partner_Type Agency | 1 |
| Partner_Type vacío | 5.553 |
| Account_Type Company mostrado por consulta | 3 |
| Account_Type Individual mostrado por consulta | 5 |
| Account_Type vacío | 5.546 |

Estas cifras corresponden a todos los Clients. Ni un nombre compartido ni un IATA compartido prueban duplicidad.

Accounts tiene 82 campos devueltos; Contacts 85; Deals 184; Vendors 95. Son cantidades de metadatos, incluyendo campos estándar y técnicos, no cuotas consumidas de campos personalizados.

Agent_Code es texto con metadatos de unicidad sin distinguir mayúsculas. También existe Agent_Code_Auto_Number: no sustituir ni regenerar Agent_Code.

Accounts mantiene Account_Name, Parent_Account (lookup a Accounts), IATA_Code (texto), Consortia (picklist), Partner_Type, Flag_As_Deleted, EZUS_API_Ref, Commission_PCT, Auto_add_Commission, Payment_Terms y Payment_Terms_Days. No se deben convertir condiciones de pago existentes en método de pago: representan conceptos distintos.

Contacts mantiene Account_Name a Accounts, Vendor_Name a Vendors y Person a Persons. Persons se muestra como Hosts and Guides, por lo que no es un maestro genérico de identidad confirmado. Existe Persons_X_Suppliers con lookups Person y Supplier a Vendors. No se ha auditado toda la población de Contacts ni la cardinalidad real de relaciones persona/proveedor.

Deals mantiene Account_Name y Contact_Name independientes, Parent_Agency a Accounts, IATA_Code y Consortia como texto, Client_Type como picklist y Payment_method como picklist. Los nuevos campos no se poblarán en bookings existentes en la primera migración.

## Colisiones de etiquetas y valores

Account_Type ya se etiqueta Client Type. En el layout Standard sus valores internos Analyst y Competitor se muestran como Company e Individual. La lista global de metadatos conserva además valores estándar que no aparecen como opciones del layout. No convertir Analyst en una clasificación comercial sin revisar su significado contextual.

Propuesta de edición posterior: conservar la API Account_Type y cambiar su etiqueta a Legacy Client Classification antes de mostrar el nuevo Client_Type. Esa edición requiere revisar dependencias y traducciones; no se ha aplicado.

Deals.Client_Type contiene Agency, Co-Branded Agency, Wendy Perrin Client, Direct Client y Agent. Representa modalidades de venta. Mantener su API y proponer la etiqueta Sales Client Category tras revisar dependencias. No migrarlo a Accounts.Client_Type.

Consortia también tiene valores internos y etiquetas distintos. Por ejemplo, Ensamble se muestra EN - Ensemble, Virtuoso se muestra VI - Virtuoso y Wendy Perrin se muestra WP - Referral Wendy Perrin. Existen valores de registros fuera de las etiquetas actuales del layout; deben preservarse literalmente.

| Valor devuelto en Accounts.Consortia | Registros |
| --- | --- |
| VI - Virtuoso | 2.098 |
| OT - | 1.167 |
| IN - Internova | 52 |
| WP - | 94 |
| EN - Ensemble | 646 |
| OT - Other | 633 |
| SI - Signature | 589 |
| VG - Virtuoso - GTC | 34 |
| AD - Administracion | 9 |
| TL - Travel Leaders Network | 37 |
| - Unassigned | 39 |
| GT - GTC | 15 |
| WP - Referral Wendy Perrin | 49 |
| Vacío | 92 |

Accounts y Contacts tienen un layout Standard. Deals tiene Standard y Ezus Standard. Las listas de perfiles de layouts incluyen 11 perfiles; su asociación no acredita permisos efectivos de creación de campos, acceso a futuras notas o administración de módulos.

# Dependencias verificadas

Se enumeraron 550 funciones en tres páginas con final de paginación. La enumeración completa de metadatos no equivale a revisión completa del código de las 550 funciones.

| Dependencia | Evidencia remota o local | Consecuencia |
| --- | --- | --- |
| venset_upsertagentcommissionsettlement | Fuente publicada leída; modificada el 30 de septiembre de 2026. Usa Agent_Code para buscar Vendors.TP_Reference y prioriza Accounts.IATA_Code sobre Deals.IATA_Code. | Adaptar en fase futura para respetar atribución de venta. No ejecutar para comprobar publicación. |
| bp_orchestratebookingtransition | Fuente publicada leída; modificada el 11 de noviembre de 2026. Para booking_won y auto_assign_booking_won escribe Booking_Won_Date si está vacío, con Europe/Madrid. | Punto común confirmado para diseñar captura futura; estudiar orden, errores y reintentos antes de implementarla. |
| Booking Handling | Blueprint activo 616617000135728024, Ezus Standard, campo Stage. | Revisar vías externas y layout Standard además de estas transiciones. |
| New Booking Won | Transición 616617000135728045 → acción 616617000156142137 → updatingwhentransitionisnewbookingwon1. Su fuente llama al orquestador con booking_won. | Ruta nativa confirmada. |
| Auto-Assign Booking Won | Transición 616617000160099115 → acción 616617000160099135 → updatewhentransitionisautoassignreservationsrep. Su fuente llama al orquestador con auto_assign_booking_won. | Ruta nativa confirmada; el API name de la función no coincide literalmente con el nombre de la transición. |
| parseezusprojecttozohobooking | Fuente publicada leída, modificada el 6 de octubre de 2026. No aparecen los campos IATA ni Consortia en el código leído. | No generalizar a todos los escritores de bookings. |
| validateagencyexists y validateagencyonflagasdeletedfalse | Fuentes publicadas leídas. Buscan Account_Name sin escape de caracteres reservados y bloquean nombres iguales entre Flag_As_Deleted false. | Revisar búsqueda, paginación y tratamiento de errores; sustituir criterio de identidad sin prohibir homónimos legítimos. Asociación efectiva de validaciones aún pendiente. |
| validateagencyiatacode | Fuente publicada leída: permite vacío y exige ocho dígitos si informado. | No usar como prueba de que la población histórica ya cumple la regla. |
| upsertagencyinezuswithtoken | Fuente publicada leída: envía nombre, Agent_Code como accounting-number, IATA, Consortia transformada por separación y nombre del Parent_Account. | Adaptar proyección actual sin cambiar referencias externas. No deducir grupo ni patrocinio de esta transformación. |
| upsertcontactinezuswithtoken | Fuente publicada leída: requiere Account_Name y obtiene la agencia desde ese lookup. | Mantener contrato de afiliación principal actual o adaptar explícitamente. |
| updateparentagencyname1 | Fuente publicada leída: consulta Parent_Account y escribe Parent_Agency_Name. | Investigar discrepancia con el esquema actual: Parent_Agency_Name no figura entre los campos actuales de Accounts. No crear el campo para satisfacer código antiguo sin revisar asociación y propósito. |
| schedulerexecuteassociatepersontocontact | Fuente publicada leída; llama associatePersonToContact. Schedule Associate Person to Contact activo cada dos horas. | Completar revisión de función llamada antes de alterar identidades de Contacts/Persons. |
| booking-overview.js | app/js/booking-overview.js carga Consortia desde Accounts para mostrar el resumen del booking. | Separar vista actual y vista de venta en una fase autorizada; el widget local tiene cambios previos y no se ha editado. |
| document-service-rules.js | app/js/document-service-rules.js consulta Contacts.Contact_Type para contactos de proveedores. | Conservar Contact_Type hasta adaptar selección documental y probarla. |

Schedules: 14 configuraciones devueltas, paginación completa. También hay procesos de administración, actualización de fechas desde Analytics y cambios de estados de booking que deben revisarse antes de activar captura o migraciones. No se ha ejecutado ninguno.

Candidatos identificados por metadatos y pendientes de revisión de fuente/asociaciones: sendagencytoezus, sendagencytoezusbtn, syncagencycontactstoezusoncreatewithtoken, sendagencytotp, sendmultipleagencytotourplan, SendAgencyToTPService, sendContactToTP, SendContactToTPService, associatePersonToContact, create_and_associate_persons_on_contacts, update_booking_contact_based_on_analytics_v2 y updatebookingcontactfromanalytics. La existencia de una función no prueba que se esté ejecutando.

## Cobertura pendiente y permisos

Las lecturas de workflows de Accounts, Contacts y Deals mediante el conector disponible devolvieron OAUTH_SCOPE_MISMATCH. La consulta CurrentUser también devolvió ese error. No se puede afirmar que workflows, permisos efectivos o automatizaciones de creación estén auditados.

Pendientes antes de escritura: workflows con criterios y acciones, asociaciones de validation rules, layout rules, client scripts, funciones restantes que leen/escriben estos campos, informes y Zoho Analytics, integraciones externas, widgets publicados, Creator, permisos de campo y registro, y automatizaciones que se ejecutarían al crear registros de los módulos nuevos.

No hay comprobación actual de edición/licencia, módulos personalizados disponibles, máximos por tipo de campo, lookups por módulo, campos únicos, dependencias de picklist ni capacidad de userlookup. Los 52 módulos con generated_type custom visibles no representan necesariamente toda la cuota consumida. Debe obtenerse capacidad real de la organización antes de crear los cuatro módulos o los campos de Deals.

# Diccionario preparado

Los API names nuevos son propuestas comprobadas contra el inventario recibido, sujetas a compatibilidad y cuotas. No se crea nada en esta fase. Tamaños de texto, límites de contenido y permisos deben fijarse tras medir la información a migrar y confirmar capacidad. Ningún campo nuevo se hará obligatorio globalmente en registros existentes.

Los módulos nuevos reutilizarán Name y Created_By/Created_Time estándar, además del resto de campos de sistema que CRM incorpore. No duplicar campos estándar de autor/fecha.


## Accounts

| API propuesto | Tipo | Valores | Regla |
| --- | --- | --- | --- |
| Client_Type | picklist | Agency / Private Client | Crear; colisión de etiqueta con Account_Type. |
| Organization_Level | picklist | Group / Agency / Branch | Vacío para Private Client. |
| Commercial_Status | picklist | Active / Inactive / Closed | Sin inferir de Flag_As_Deleted ni última venta. |
| Current_Consortia | lookup Consortia | — | Proyección del periodo vigente confirmado. |
| Data_Quality_Status | picklist | Confirmed / Pending Review / Duplicate | Duplicate exige revisión humana. |
| Canonical_Client | lookup Accounts | — | Sin autorreferencia ni cadenas/ciclos; solo duplicados confirmados. |
| Available_for_New_Bookings | boolean | — | Regla propuesta pendiente; no poblar masivamente todavía. |

## Contacts

| API propuesto | Tipo | Valores | Regla |
| --- | --- | --- | --- |
| Contact_Roles | multiselectpicklist | Travel Agent / Private Client / Supplier Contact | Roles simultáneos; validar contexto. |
| Functional_Roles | multiselectpicklist | Reservations / Accounting / Rates / Management / Sales / Other | No migrar función global si corresponde a proveedores distintos. |

## Consortia

| API propuesto | Tipo | Valores | Regla |
| --- | --- | --- | --- |
| Name | text | — | Nombre principal del módulo; no duplicar campo estándar. |
| Consortia_Code | text unique | — | Código estable; no derivarlo de nombre mutable. |
| Status | picklist | Active / Inactive | Sin desactivar por ausencia de ventas. |
| Migration_Key | text unique | — | Clave de origen determinista; también para lotes repetidos. |
| Migration_Batch | text | — | Identificador de lote. |
| Legacy_Source | textarea | — | Módulo, ID, campo, valor original y regla aplicada; sin fuentes Deluge. |

## Commercial_History

| API propuesto | Tipo | Valores | Regla |
| --- | --- | --- | --- |
| Name | text | — | Título; usar principal estándar. |
| History_Type | picklist | Agent Affiliation / Consortia Membership / IATA Assignment / Organization Relationship | Obligatorio. |
| Client | lookup Accounts | — | Obligatorio para los cuatro tipos. |
| Contact | lookup Contacts | — | Solo Agent Affiliation; obligatorio en ese tipo. |
| Related_Client | lookup Accounts | — | Solo Organization Relationship; superior obligatorio. |
| Consortia | lookup Consortia | — | Solo Consortia Membership; obligatorio. |
| IATA_Code | text | — | Solo IATA Assignment; preservar ceros; obligatorio en ese tipo. |
| IATA_Holder | lookup Accounts | — | Solo IATA Assignment; titular si está identificado. |
| Relationship_Subtype | picklist | Branch Of / Part Of Group | Solo Organization Relationship; obligatorio. |
| Primary_Relationship | boolean | — | Definir partición por tipo y cliente/contacto antes de activar validación. |
| Valid_From | date | — | Incluido; vacío permitido si se desconoce. |
| Valid_To | date | — | Excluido; si ambos existen exigir From < To. |
| Observed_On | date | — | Fecha de observación, sin sustituir inicio real. |
| Data_Quality | picklist | Confirmed / Estimated / Pending Review | Estimated requiere evidencia; no inventar fecha. |
| Change_Reason | textarea | — | Motivo del cambio/corrección. |
| Source | textarea | — | Referencia verificable y procedencia; conservar valores originales. |
| Migration_Key | text unique | — | Clave de origen determinista; también para lotes repetidos. |
| Migration_Batch | text | — | Identificador de lote. |
| Legacy_Source | textarea | — | Módulo, ID, campo, valor original y regla aplicada; sin fuentes Deluge. |

## Preferences

| API propuesto | Tipo | Valores | Regla |
| --- | --- | --- | --- |
| Name | text | — | Título estándar. |
| Preference_Type | picklist | Commercial / Team Assignment / Operational / Communication | Obligatorio. |
| Preference_Key | picklist | Price Presentation / Payment Method / Preferred Staff / Avoid Staff / Preferred Channel | Dependencia por tipo pendiente de matriz final. |
| Client | lookup Accounts | — | Destinatario según contrato de alcance. |
| Contact | lookup Contacts | — | Destinatario según contrato de alcance. |
| Vendor | lookup Vendors | — | Destinatario según contrato de alcance. |
| Commercial_History | lookup Commercial_History | — | Opcional; Specific Affiliation exige periodo Agent Affiliation. |
| Booking | lookup Deals | — | Booking Only exige booking. |
| Scope | picklist | General / Specific Affiliation / Booking Only | Obligatorio. |
| Preference_Value | picklist | — | Valores por clave pendientes de acordar; no texto libre para reglas. |
| Team_Member | userlookup | — | Solo claves de equipo; verificar capacidad de lookup a usuario. |
| Department | picklist | — | Catálogo de departamentos pendiente; no confundir con perfiles/grupos CRM. |
| Strength | picklist | Preference / Restriction | Avoid avisa; no bloquea sin acuerdo expreso. |
| Valid_From | date | — | Periodo de aplicación. |
| Valid_To | date | — | Excluido; validar orden. |
| Status | picklist | Active / Archived | Obligatorio. |
| Notes | textarea | — | Contexto; no convertir en regla automáticamente. |
| Migration_Key | text unique | — | Clave de origen determinista; también para lotes repetidos. |
| Migration_Batch | text | — | Identificador de lote. |
| Legacy_Source | textarea | — | Módulo, ID, campo, valor original y regla aplicada; sin fuentes Deluge. |

## Client_Contact_Notes

| API propuesto | Tipo | Valores | Regla |
| --- | --- | --- | --- |
| Name | text | — | Título estándar. |
| Content | textarea | — | Contenido libre; dimensionar tras medir datos. |
| Category | picklist | Commercial / Operational / Pricing / Payments / Assignment | Obligatorio. |
| Client | lookup Accounts | — | Se permiten varias referencias simultáneas coherentes. |
| Contact | lookup Contacts | — | Conservar identidad y contexto. |
| Vendor | lookup Vendors | — | Sin crear histórico de proveedores. |
| Commercial_History | lookup Commercial_History | — | Alcance de afiliación si corresponde. |
| Booking | lookup Deals | — | Obligatorio con Booking Only. |
| Scope | picklist | General / Specific Affiliation / Booking Only | Exigir al menos un destinatario y referencias coherentes. |
| Valid_From | date | — | Inicio conocido, opcional. |
| Valid_To | date | — | Fin excluido. |
| Status | picklist | Active / Archived | Permisos reales por módulo, perfil y registros. |
| Migration_Key | text unique | — | Clave de origen determinista; también para lotes repetidos. |
| Migration_Batch | text | — | Identificador de lote. |
| Legacy_Source | textarea | — | Módulo, ID, campo, valor original y regla aplicada; sin fuentes Deluge. |

## Deals

| API propuesto | Tipo | Valores | Regla |
| --- | --- | --- | --- |
| Sale_Consolidated_Agency | lookup Accounts | — | Solo futuras capturas. |
| Sale_Group | lookup Accounts | — | Solo futuras capturas. |
| Sale_Consortia | lookup Consortia | — | Identidad al vender; el nombre también debe conservarse. |
| Sale_Agent_Affiliation | lookup Commercial_History | — | Periodo seleccionado; no derivar después del contacto actual. |
| Sale_IATA_Period | lookup Commercial_History | — | Periodo seleccionado al vender. |
| Sale_Consortia_Period | lookup Commercial_History | — | Periodo seleccionado al vender. |
| Sale_Agency_Hierarchy_Period | lookup Commercial_History | — | Tramo de jerarquía hacia agencia consolidada. |
| Sale_Group_Hierarchy_Period | lookup Commercial_History | — | Tramo hacia grupo. |
| Sale_Client_Name | text | — | Nombre del Client al vender. |
| Sale_Agent_Name | text | — | Nombre del agente al vender. |
| Sale_Consolidated_Agency_Name | text | — | Nombre de agencia consolidada al vender. |
| Sale_Group_Name | text | — | Nombre del grupo al vender. |
| Sale_Snapshot_Captured_At | datetime | — | Instante de captura con zona horaria. |
| Sale_Snapshot_Locked | boolean | — | Bloqueo lógico requiere permisos y validación de todos los escritores. |
| Sale_Snapshot_Source | textarea | — | Origen, versión y referencias de captura/corrección. |
| Agreed_Price_Presentation | picklist | — | Valores de negocio pendientes. |
| Agreed_Payment_Method | picklist | — | Revisar Payment_method antes de crear clasificación redundante. |
| Operational_Contact | lookup Contacts | — | Contacto operativo separado del agente de venta. |


## Campos que se conservan

- Accounts: Account_Name, Agent_Code, Agent_Code_Auto_Number, Parent_Account, IATA_Code, direcciones/ciudad/país, EZUS_API_Ref, referencias externas, comisiones y condiciones de pago.
- Accounts temporales: Partner_Type, Account_Type, Flag_As_Deleted, Consortia, Preferred_Sales_REP, Preferred_Reservation_REP, Important_Agency_Notes, Marketing_Notes y otros textos originales.
- Contacts: identidad, email/teléfonos, Account_Name, Vendor_Name, Title, Status y Person. Conservar Contact_Type y notas originales durante migración.
- Vendors: estructura, contactos, Persons_X_Suppliers, categoría Host y referencias externas. No crear histórico de Vendors.
- Deals: conservar todos los registros y campos existentes, incluidas relaciones, importes, estados, IATA_Code, Consortia y Booking_Won_Date. No completar capturas retrospectivas en fase uno.

## Complementos necesarios que requieren decisión

1. Commercial History necesita distinguir fin desconocido de periodo vigente confirmado. Propuesta: Period_Status = Current Confirmed / Historical / Pending Review. Una fila con Valid_To vacío no se considera vigente por sí sola. Data_Quality mide calidad y no sustituye este estado. Un Current Confirmed con inicio desconocido solo acredita vigencia en Observed_On; no prueba fechas anteriores.
2. El bloqueo de snapshots debe conservar IATA y nombre de consortia sin depender de maestros mutables. Decidir si IATA_Code y Consortia actuales de Deals serán las copias inmutables para futuras ventas o si se requieren Sale_IATA_Code y Sale_Consortia_Name. La segunda opción añade campos y evita mezclar semánticas, pero exige auditar escritores y cuotas.
3. Para informes y referencias comerciales estables, proponer Sale_Client_Code como copia de Agent_Code. Un lookup a Accounts no preserva por sí solo el código o nombre previo si se permite corregir maestros.
4. Las condiciones acordadas requieren catálogo final de Price Presentation y Payment Method. Payment_method de Deals ya ofrece Bank Transfer, Flywire, Airwallex y Credito aplicado; revisar si representa lo mismo que Agreed_Payment_Method antes de añadirlo.
5. Definir cómo se registra una corrección excepcional del snapshot con antes/después, motivo, usuario y fecha; Source y un booleano no proporcionan por sí solos un historial inmutable.
6. Definir destinatario de Preferences: Client, Contact y Vendor no pueden competir como receptores sin contrato. Propuesta: exactamente uno para General; Contact + Client coherentes con afiliación para Specific Affiliation; Booking obligatorio para Booking Only y destinatario contextual explícito.
7. Definir quién puede consultar notas comerciales/financieras y si las categorías necesitan separación de acceso a registros. Category no es un control de seguridad.

# Mapa de migración

| Origen | Destino | Conversión preparada | Condición |
| --- | --- | --- | --- |
| Accounts.id y Agent_Code | Mismo registro y código | Conservar ambos; claves distintas: ID técnico e identidad comercial estable. | No regenerar. |
| Accounts.Partner_Type Agency | Accounts.Client_Type Agency | Correspondencia semántica directa propuesta; existe un registro. | Revisar registro y conflictos antes de aplicar. |
| Accounts.Partner_Type Direct Client | Accounts.Client_Type Private Client | Correspondencia preparada; cero registros en lectura. | No inferir de bookings. |
| Account_Type Individual / Competitor | Client_Type candidato Private Client | Solo candidato para revisión de cinco fichas. | Una etiqueta histórica no prueba clasificación actual. |
| Account_Type Company / Analyst | Clasificación pendiente | Tres fichas; Company no implica agencia. | No crear Corporate Client. |
| Tipo vacío | Pending Review en clasificación preparada | Conservar vacío; revisar evidencia externa. | No clasificar las 5.553 fichas por defecto. |
| Accounts.Consortia | Catálogo Consortia y Commercial History | Mapa explícito por valor bruto, valor interno, etiqueta y código destino. | No crear catálogo de basura ni poblar sin revisión. |
| Accounts.IATA_Code | Commercial History IATA Assignment | Texto literal; inicio desconocido; Observed_On = fecha real de extracción del lote. | No rellenar pasado; vigencia actual por confirmar. |
| Accounts.Parent_Account | Commercial History Organization Relationship | Mantener IDs hijo/superior. | Revisar niveles, subtipo, ciclos y si la relación sigue vigente. |
| Contacts.Account_Name | Agent Affiliation | Contact + Client; no asumir que todos son agentes. | Contact_Roles y vigencia revisados previamente. |
| Contacts.Contact_Type | Contact_Roles y Functional_Roles | Separar identidad comercial y función. | No migrar todas las funciones como Travel Agent. |
| Preferred_Sales_REP / Preferred_Reservation_REP | Preferences o Client & Contact Notes | Resolver usuario CRM y departamento; copiar texto original a procedencia. | Preferencia solo cuando inequívoca; resto nota pendiente. |
| Important_Agency_Notes / Marketing_Notes | Client & Contact Notes | Una nota por origen con categoría revisada. | No convertir comentario en restricción. |
| Important_Agent_Notes | Client & Contact Notes | Nota vinculada a Contact y contexto conocido. | No añadir agencia actual a notas antiguas sin evidencia. |
| Flag_As_Deleted | Clasificación pendiente | Conservar original. | No mapear automáticamente a Closed, Inactive o Duplicate. |
| Duplicado confirmado | Canonical_Client + Data_Quality_Status | Conservar ficha e IDs externos. | No reasociar bookings ni fusionar en fase uno. |
| Deals existentes | Sin cambios | Conservar todas las relaciones y valores. | Ningún backfill de snapshots. |

## Correspondencias de Consortia para revisión

| Valor origen | Candidato | Tratamiento |
| --- | --- | --- |
| VI - Virtuoso / Virtuoso | Virtuoso | Un candidato; preservar variante original. |
| IN - Internova / Internova | Internova | Revisar naturaleza y relación con otras redes; no crear jerarquía implícita. |
| SI - Signature / Signature | Signature | Candidato directo sujeto a revisión. |
| EN - Ensemble / Ensamble | Ensemble | Conservar error ortográfico interno como alias de origen. |
| GT - GTC / GTC | GTC | Revisar catálogo y significado. |
| TL - Travel Leaders Network | Travel Leaders Network | Revisar clasificación. |
| VG - Virtuoso - GTC / Virtuoso - GTC | Pendiente | Compuesto; no convertir automáticamente en una sola afiliación o dos simultáneas. |
| WP - / WP - Referral Wendy Perrin / Wendy Perrin | Pendiente | Distinguir referencia comercial de consortia. |
| OT - / OT - Other / Other | Sin equivalencia confirmada | No crear una consortia Other. |
| AD - Administracion / Administration | Pendiente | Categoría administrativa; no asumir consortia. |
| - Unassigned / vacío | Sin afiliación confirmada | No crear periodo ficticio de no pertenencia. |

Para Contact_Type: AC → Accounting; RE → Reservations; RT → Rates; GM y MA → Management; SA → Sales son candidatos funcionales. AG sugiere Travel Agent pero requiere contexto. GE, RC y ZZ necesitan revisión: no imponer Other ni nuevos roles automáticamente. Preservar valor interno y etiqueta; por ejemplo RE Reservas se muestra RE - Reservas.

# Reglas antes de activar procesos

Commercial History validará campos requeridos y prohibidos por tipo, intervalos [Valid_From, Valid_To), y solapamientos dentro de la relación correspondiente. Las afiliaciones simultáneas reales son válidas; la principal se define por entidad y contexto. No imponer unicidad global de IATA: puede compartirse legítimamente. Los periodos desconocidos requieren revisión y no se resolverán como cobertura histórica abierta hacia menos infinito.

La jerarquía debe impedir ciclos, autorreferencias y combinaciones de nivel incompatibles. No heredar automáticamente IATA, consortia ni preferencias de una matriz. Si se permite una jerarquía con más de dos saltos, los dos lookups de periodos propuestos en Deals podrían no representar toda la cadena: acordar límites o captura de cadena antes de implementar informes.

Available_for_New_Bookings: propuesta inicial Active + Confirmed + sin redirección canónica; decidir si Pending Review puede operar con advertencia y cómo tratar Private Client. No activar esta fórmula como filtro hasta revisar población y políticas.

Preferencias: Booking explícito → afiliación → contacto → sede → agencia, con conflictos visibles. Una Restriction no puede ser desplazada silenciosamente por una preferencia más específica. Definir si el grupo participa y cómo, sin inferir herencia.

Captura futura: verificar todas las entradas a Booking Won; resolver periodos seleccionados, identidad, nombres y condiciones; escribir copia completa y bloquear tras éxito verificable. Reintentos no recapturan desde maestros cambiados. Tratar fallos parciales entre cambio de Stage y captura; comprobar si el estado puede avanzar antes de que la acción posterior falle. No ejecutar funciones de negocio en esta auditoría.

# Línea base y recuperación preparadas

Antes de migrar se necesita respaldo recuperable de registros, relaciones, valores originales, metadatos y configuraciones. No se ha creado aún. Las fuentes publicadas Deluge consultadas se mantuvieron en memoria: no se guardan en este proyecto. La recuperación de funciones necesitará mecanismo aprobado fuera del proyecto o versionado remoto, sin exportar fuentes aquí.

Cada lote tendrá clave determinista basada en módulo/ID/campo/tipo y, si procede, periodo documentado. La clave de una observación inicial no cambiará por repetir el mismo lote en otra fecha. No depender de nombres como clave. Registrar por fila origen, destino, operación, antes/después, resultado y motivo de revisión. Reread de escrituras confirmadas; respuesta perdida queda pendiente de conciliación antes de reintentar.

La línea base de Deals debe incluir todos sus IDs, relaciones y campos a proteger, además de Modified_Time, cantidades, comisiones, fechas y estado. Comparar por registro y totales; una diferencia concurrente se investiga en vez de atribuirla automáticamente al lote. Las sumas se calculan desde Deals sin unir todas las filas de Commercial History. El criterio de cero bookings modificados por migración requiere trazabilidad del escritor, además del hash de campos.

Recuperación: eliminar únicamente filas nuevas identificadas por Migration_Key y lote autorizado, después de comprobar referencias creadas; restaurar maestros modificados solo con valores anteriores y guardas de concurrencia. No borrar fichas origen, no deshacer cambios posteriores de usuarios y no usar eliminación en cascada. Ensayar recuperación con piloto controlado antes de lotes generales.

# Condiciones para pasar a escritura

1. Completar workflows, validaciones asociadas, permisos, informes, Creator e integraciones pendientes; resolver OAUTH_SCOPE_MISMATCH mediante autorización del conector.
2. Comprobar cuotas reales y compatibilidad de cuatro módulos nuevos, lookups, campos únicos y userlookup. Confirmar etiquetas, traducciones y tamaños definitivos.
3. Resolver vigencia explícita, captura de IATA/consortia, reglas de disponibilidad, métodos de pago, alcance de preferencias y permisos de notas.
4. Revisar correspondencias de clasificación, consortia y jerarquía con casos concretos; patrocinio sigue pendiente y no genera campos.
5. Crear respaldo recuperable y línea base; preparar piloto, claves idempotentes, controles y recuperación.
6. Presentar el manifiesto de creación/edición ya cerrado para autorización de escritura. No retirar campos antiguos en esa fase.

El proyecto local tenía numerosos cambios anteriores, incluidos archivos modificados, borrados y nuevos. Se preservan todos. La única incorporación de esta tarea es este informe; no se generaron ZIP, imágenes, capturas ni previews, ni se enviaron comunicaciones.

