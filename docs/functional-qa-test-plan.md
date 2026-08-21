# Plan de pruebas funcionales de Qualyra GMP

## 1. Objetivo y alcance

Este documento define una línea base reproducible y casos funcionales para validar Qualyra GMP desde la interfaz. La ejecución cubre autenticación, autorización, trazabilidad, firmas por reautenticación, segregación de funciones, evidencia fotográfica, responsive e idioma, además de los procesos de calidad disponibles.

La Fase 39 queda fuera de este alcance y en estado **On Hold**. Los defectos encontrados deben registrarse sin mezclar cambios de alcance de esa fase.

## 2. Línea base preparada

- Organización: `Qualyra QA`
- Identificador de organización para iniciar sesión: `qualyra-demo`
- Estado: `ACTIVE`
- Plan: `ENTERPRISE`
- Suscripción: activa, manual y sin cobro real
- Empresas en la base local: `1`
- Evidencia fotográfica inicial: `0 bytes / 0 fotos`
- Contraseña temporal común: `QualyraQA2026!`

La contraseña compartida existe únicamente para el ambiente local de QA. No debe reutilizarse en demostraciones públicas, staging ni producción.

### Usuarios de prueba

| Actor                | Correo                     | Rol                 | Uso principal                                                                  |
| -------------------- | -------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| Administrador        | `admin@qualyra.local`      | Administrator       | Configuración, liberación documental y verificación independiente de cambios   |
| Control documental   | `controller@qualyra.local` | Document Controller | Documentos, investigaciones, proveedores y equipos                             |
| Operador             | `operator@qualyra.local`   | Operator            | Reportes, tareas, capacitaciones y ejecución de acciones                       |
| Revisor de calidad   | `reviewer@qualyra.local`   | QA Manager          | Revisión, evaluación, investigación y decisiones de calidad                    |
| Aprobador de calidad | `approver@qualyra.local`   | QA Manager          | Aprobación y planificación independiente                                       |
| Auditor              | `auditor@qualyra.local`    | Auditor             | Auditorías y revisiones independientes de riesgo, proveedor, equipo y producto |

Aunque Revisor y Aprobador poseen el mismo rol, son identidades diferentes. Esa separación es necesaria para comprobar las reglas de independencia.

## 3. Reglas de ejecución

1. Ejecutar primero los casos de humo y acceso.
2. Usar los actores indicados; no sustituirlos por el Administrador salvo que el caso lo pida.
3. Para fechas futuras usar, como mínimo, `hoy + 7 días`; para periodos PQR/APR usar un rango cerrado anterior a hoy.
4. Añadir el prefijo `QA-` a títulos, referencias y archivos para localizar los datos fácilmente.
5. Tras cada transición, recargar la página y comprobar que el estado y la evidencia permanecen.
6. En toda firma probar primero una contraseña incorrecta y luego la correcta, salvo cuando el caso indique lo contrario.
7. Capturar como evidencia del caso: código generado, estado final, actor, fecha/hora y mensaje mostrado.
8. Un caso falla si la UI aparenta éxito pero el dato desaparece al recargar, si un actor no autorizado puede actuar o si se pierde el historial previo.

### Datos reutilizables

- Producto: `Producto QA 10 mg`
- Lote: `QA-LOT-2026-001`
- Área: `Empaque QA`
- Proceso: `Inspección visual`
- Proveedor: `Proveedor QA de Empaques`
- Equipo: `Balanza QA`
- Archivo JPEG válido: `qa-evidencia-tablet.jpg`
- Archivo no permitido para prueba negativa: `qa-no-permitido.exe`
- Contraseña incorrecta: `Incorrecta-2026!`

## 4. Criterios generales de aceptación

Todo caso de transición o firma debe cumplir estos criterios además de su resultado específico:

- el código y el estado se muestran correctamente en lista y detalle;
- el actor autenticado y la fecha/hora quedan atribuidos;
- la reautenticación incorrecta no cambia el estado;
- una firma correcta crea evidencia persistente y no editable;
- las acciones disponibles coinciden con el rol y el estado actual;
- una segunda ejecución de la misma acción no duplica registros;
- la interfaz comunica el resultado en español o inglés según el idioma activo;
- no aparecen errores inesperados en la pantalla y la página conserva su estructura en tablet.

## 5. Casos de humo, acceso y seguridad

### QA-SMK-001 — Disponibilidad del ambiente

**Historia:** Como tester, quiero comprobar las dependencias antes de iniciar para no confundir un problema de infraestructura con un defecto funcional.

**Pasos:**

1. Abrir `/health/ready` usando la misma dirección pública o local con la que se accede al frontend.
2. Confirmar que la respuesta tenga `status: up`.
3. Confirmar que base de datos, Redis, almacenamiento y escáner estén en estado `up`.
4. Abrir la pantalla de inicio de sesión.

**Resultado esperado:** La API está disponible, el formulario de acceso carga y el indicador del encabezado no permanece en “Sistema degradado”.

### QA-AUT-001 — Inicio y cierre de sesión válidos

**Historia:** Como usuario activo, quiero entrar solamente en mi organización y cerrar mi sesión de forma segura.

**Pasos:**

1. Iniciar sesión con organización `qualyra-demo`, `operator@qualyra.local` y la contraseña temporal.
2. Comprobar que el encabezado muestre `Qualyra QA` y `Operador QA`.
3. Cerrar sesión.
4. Intentar volver a una ruta interna con el botón Atrás del navegador.

**Resultado esperado:** El acceso es exitoso, el cierre elimina la sesión y una ruta protegida redirige al inicio de sesión.

### QA-AUT-002 — Error de acceso sin revelar cuentas

**Historia:** Como responsable de seguridad, quiero mensajes neutrales para no revelar organizaciones o usuarios válidos.

**Pasos:**

1. Intentar iniciar sesión con el Operador y la contraseña incorrecta una sola vez.
2. Repetir con un correo inexistente.
3. Repetir con una organización inexistente.
4. Iniciar sesión correctamente con el Operador.

**Resultado esperado:** Los tres rechazos usan un mensaje genérico equivalente, no revelan qué dato existe y el acceso correcto posterior sigue funcionando.

### QA-RBAC-001 — Restricción por rol

**Historia:** Como administrador de calidad, quiero que los permisos del servidor se apliquen aunque alguien intente saltarse la navegación.

**Pasos:**

1. Entrar como Operador.
2. Abrir Documentos y comprobar que puede consultar, pero no crear, revisar, aprobar ni liberar.
3. Intentar acceder directamente a una URL de creación documental si se conoce.
4. Entrar como Control documental y comprobar que sí puede crear.

**Resultado esperado:** El Operador no ve acciones no autorizadas y cualquier intento directo se rechaza; Control documental recibe las acciones correspondientes a su rol.

### QA-UX-001 — Idioma y diseño adaptable

**Historia:** Como usuario de campo, quiero operar en español o inglés desde escritorio, tablet o móvil sin perder controles.

**Pasos:**

1. Cambiar ES → EN → ES en el inicio de sesión y dentro del sistema.
2. Probar anchos aproximados de 1440, 1024, 768 y 390 píxeles.
3. Colapsar y expandir el menú lateral en escritorio.
4. Abrir y cerrar el menú en tablet y móvil.
5. Recorrer un formulario con inputs, selectores y textarea.

**Resultado esperado:** Los textos cambian sin recargar manualmente; no hay scroll horizontal de página, solapamientos ni campos desalineados; el menú no tapa el contenido y todos los elementos clicables muestran un cursor apropiado.

### QA-PLT-001 — Inventario privado de plataforma

**Historia:** Como operador comercial autorizado, quiero consultar el inventario global sin mezclar mis credenciales con las de un tenant.

**Pasos:**

1. Abrir `/platform` en una sesión nueva.
2. Introducir el valor local de `PLATFORM_ADMIN_BEARER_TOKEN` desde un canal seguro, sin registrarlo como evidencia.
3. Consultar el inventario y abrir el detalle de `Qualyra QA`.
4. Confirmar nombre, slug, plan, estado, seis usuarios y consumo fotográfico inicial.
5. Cerrar el acceso privado y volver a abrir `/platform`.
6. Intentar usar la contraseña del Administrador tenant como token de plataforma.

**Resultado esperado:** El token válido muestra exactamente una empresa; cerrar el acceso elimina el token de memoria y las credenciales del tenant no autorizan la consola global.

La creación de empresas desde la consola queda fuera de esta ejecución para preservar la línea base de un solo tenant. Si se prueba al final, se debe ejecutar después el restablecimiento completo de la sección 21.

## 6. Flujo documental y capacitación

### QA-DOC-001 — Crear un procedimiento controlado

**Historia:** Como Control documental, quiero registrar un SOP para someterlo a control formal.

**Pasos:**

1. Entrar como Control documental.
2. Crear un documento tipo SOP con código `SOP-QA-001`, título `Inspección visual de empaque` y contenido identificable como versión 1.
3. Guardar y recargar el detalle.

**Resultado esperado:** El documento y su primera versión quedan en `DRAFT`; el código es único y el autor queda atribuido a Control documental.

### QA-DOC-002 — Revisión y aprobación segregadas

**Historia:** Como dueño del proceso documental, quiero que autor, revisor y aprobador sean personas distintas.

**Precondición:** `SOP-QA-001` está en borrador.

**Pasos:**

1. Como Control documental, enviar la versión a revisión asignando Revisor de calidad y Aprobador de calidad.
2. Intentar seleccionar al autor como revisor o usar la misma persona para revisar y aprobar.
3. Como Revisor de calidad, aceptar la revisión con comentario.
4. Como Aprobador de calidad, aprobar con comentario.
5. Recargar el detalle entre cada acción.

**Resultado esperado:** Las combinaciones sin independencia se bloquean; el flujo válido avanza `IN_REVIEW` → `PENDING_APPROVAL` → `APPROVED` y conserva decisiones y comentarios.

### QA-DOC-003 — Liberación con reautenticación

**Historia:** Como Administrador independiente, quiero liberar únicamente una versión aprobada con intención y contraseña verificadas.

**Precondición:** La versión 1 de `SOP-QA-001` está aprobada.

**Pasos:**

1. Entrar como Administrador y abrir el documento.
2. Intentar liberar con la contraseña incorrecta.
3. Confirmar que continúa `APPROVED`.
4. Liberar con la contraseña correcta, confirmación explícita, motivo `Liberación para QA` y fecha efectiva permitida.
5. Recargar el detalle.

**Resultado esperado:** El primer intento no modifica el documento; el segundo deja documento y versión en `EFFECTIVE` con evidencia de liberación y huella SHA-256.

### QA-TRN-001 — Asignar y reconocer lectura

**Historia:** Como Revisor de calidad, quiero asignar una versión efectiva y que el Operador reconozca exactamente el contenido liberado.

**Precondición:** `SOP-QA-001` está efectivo.

**Pasos:**

1. Como Revisor de calidad, asignar la capacitación al Operador con vencimiento futuro.
2. Intentar crear la misma asignación pendiente por segunda vez.
3. Como Operador, abrir Mis capacitaciones y leer el contenido.
4. Intentar completar con contraseña incorrecta.
5. Completar con contraseña correcta, atestación y comentario `Contenido revisado durante QA`.

**Resultado esperado:** No se duplica una asignación abierta; sólo el participante puede completarla y el resultado `COMPLETED` conserva versión, comentario, sesión y huella.

### QA-DOC-004 — Nueva revisión y sustitución de versión

**Historia:** Como Control documental, quiero actualizar un procedimiento sin retirar anticipadamente la versión vigente.

**Pasos:**

1. Crear una nueva versión de `SOP-QA-001` con contenido `Versión 2 QA`.
2. Confirmar que la versión 1 sigue efectiva mientras la 2 está en borrador/revisión.
3. Repetir revisión con Revisor, aprobación con Aprobador y liberación con Administrador.
4. Revisar el historial y las capacitaciones pendientes de la versión anterior.

**Resultado esperado:** La versión 2 queda `EFFECTIVE`, la 1 `SUPERSEDED`, no existen dos versiones efectivas y las asignaciones abiertas de la versión sustituida se cancelan sin borrar completadas.

### QA-DOC-005 — Revisión periódica y obsolescencia

**Historia:** Como calidad, quiero confirmar vigencia o retirar un documento conservando la evidencia histórica.

**Pasos:**

1. Como Control documental, configurar revisión periódica de la versión efectiva y asignar al Revisor.
2. Como Revisor, registrar `CONFIRM_EFFECTIVE` y comprobar que se crea el próximo ciclo.
3. Como Administrador, intentar obsoletar con contraseña incorrecta.
4. Obsoletar con contraseña correcta, intención y motivo `Retiro controlado de prueba`.

**Resultado esperado:** La decisión periódica permanece en historial; la obsolescencia válida deja documento y versión en `OBSOLETE` y cancela el ciclo/asignaciones abiertas aplicables.

## 7. Desviaciones y CAPA

### QA-DEV-001 — Reportar desviación con foto desde tablet

**Historia:** Como Operador, quiero reportar una desviación en el lugar del evento y adjuntar una fotografía tomada con la cámara trasera.

**Pasos:**

1. Desde una tablet, entrar como Operador y crear `QA - Sello incompleto en empaque` en el área y proceso definidos.
2. Usar `Tomar foto` y capturar una imagen; completar descripción y fecha de ocurrencia no futura.
3. Enviar el formulario.
4. Abrir el registro y la evidencia fotográfica.

**Resultado esperado:** Se genera `DEV-YYYY-NNNN` en `REPORTED`; la foto se carga después de crear el padre, muestra vista previa/metadatos y puede descargarse o visualizarse según permisos.

### QA-DEV-002 — Clasificar y asignar investigación

**Historia:** Como Revisor de calidad, quiero clasificar el evento y asignar a una persona calificada.

**Pasos:**

1. Entrar como Revisor y abrir la desviación.
2. Clasificarla como `MAJOR`, documentar contención e impacto y asignar a Control documental como investigador.
3. Intentar repetir la clasificación desde otra sesión o pestaña.

**Resultado esperado:** La primera transición deja la desviación `UNDER_INVESTIGATION`; la segunda se rechaza y no duplica evidencia.

### QA-DEV-003 — Investigación firmada que requiere CAPA

**Historia:** Como investigador asignado, quiero documentar causa raíz y decidir justificadamente si requiere CAPA.

**Pasos:**

1. Entrar como Control documental.
2. Completar la investigación con método `FIVE_WHYS`, problema, cronología, causa inmediata, causa raíz, factores contribuyentes e impacto.
3. Marcar que requiere CAPA y justificarlo.
4. Probar la contraseña incorrecta y después firmar con la correcta.

**Resultado esperado:** Sólo el investigador asignado puede firmar; el registro pasa a `INVESTIGATION_COMPLETED`, conserva la investigación inmutable y queda disponible para crear CAPA.

### QA-CAPA-001 — Crear plan CAPA controlado

**Historia:** Como Aprobador de calidad, quiero convertir la causa confirmada en acciones correctivas y preventivas asignables.

**Pasos:**

1. Entrar como Aprobador y crear una CAPA desde la desviación investigada.
2. Usar título `QA - Corrección de sellado` y objetivo medible.
3. Crear una acción correctiva para Operador y una preventiva para Control documental, ambas con fecha futura.
4. Intentar crear otra CAPA desde la misma desviación.

**Resultado esperado:** Se genera `CAPA-YYYY-NNNN`, el plan queda bloqueado con dos acciones abiertas y el duplicado se rechaza.

### QA-CAPA-002 — Evidencia y ejecución por responsable

**Historia:** Como responsable de una acción, quiero adjuntar evidencia y firmar mi propia implementación.

**Pasos:**

1. Como Operador, cargar un JPEG o PDF permitido en su acción.
2. Intentar completar con contraseña incorrecta y luego con la correcta, atestación y comentario.
3. Como Control documental, completar su propia acción de la misma forma.
4. Intentar completar cualquiera de las acciones una segunda vez.

**Resultado esperado:** Cada usuario actúa sólo sobre su acción; el archivo pasa validación, las acciones quedan `COMPLETED`, se guardan huellas y no se aceptan repeticiones.

### QA-CAPA-003 — Bloqueos de archivo y asignación

**Historia:** Como responsable de seguridad, quiero impedir evidencia peligrosa y ejecución por terceros.

**Pasos:**

1. En una acción todavía abierta de otro ciclo, intentar cargar `qa-no-permitido.exe` o un archivo cuyo contenido no coincida con la extensión.
2. Como un usuario distinto del asignado, intentar completar la acción.

**Resultado esperado:** El archivo se rechaza o queda sin consumir y el actor no asignado no puede completar; el estado de la acción permanece abierto.

### QA-CAPA-004 — Verificación efectiva y cierre atómico

**Historia:** Como Revisor independiente, quiero comprobar la efectividad antes de cerrar la desviación fuente.

**Precondición:** Todas las acciones del ciclo están completas.

**Pasos:**

1. Como Aprobador, programar revisión con criterio observable, fecha futura y Revisor de calidad como responsable.
2. Comprobar que no se permite seleccionar a un ejecutor de acciones como revisor.
3. Como Revisor, firmar `EFFECTIVE` con evidencia narrativa.
4. Abrir la CAPA y la desviación fuente.

**Resultado esperado:** La CAPA queda `CLOSED_EFFECTIVE` y la desviación pasa a `CLOSED` en la misma operación; ambas muestran la evidencia de efectividad.

### QA-CAPA-005 — Resultado inefectivo y ciclo de seguimiento

**Historia:** Como calidad, quiero conservar una verificación inefectiva y abrir acciones nuevas sin reescribir la historia.

**Precondición:** Preparar una segunda desviación/CAPA con todas sus acciones completas.

**Pasos:**

1. Programar y firmar la revisión como `INEFFECTIVE`.
2. Confirmar que la desviación no se cierra.
3. Como Aprobador, crear un ciclo de seguimiento con justificación y una acción nueva para Operador.
4. Completar la acción, programar una segunda revisión y firmarla `EFFECTIVE` con Revisor.

**Resultado esperado:** El primer ciclo permanece inmutable, el segundo se numera consecutivamente y sólo la revisión efectiva final cierra CAPA y desviación.

## 8. Control de cambios

### QA-CHG-001 — Cambio con cuatro identidades independientes

**Historia:** Como organización regulada, quiero evaluar, aprobar, implementar y verificar un cambio con segregación de funciones.

**Pasos:**

1. Como Control documental, proponer `QA - Ajuste de inspección visual`, categoría `PROCESS`, justificación y fecha objetivo.
2. Como Revisor, evaluar impactos de calidad, regulación, validación, capacitación y documentos; definir riesgo, rollback, criterio observable, Operador como dueño, Aprobador como aprobador, Administrador como verificador y una tarea para Operador.
3. Intentar elegir al proponente como evaluador/aprobador/verificador o al Operador ejecutor como verificador.
4. Como Aprobador, firmar `APPROVE`.
5. Como Operador, firmar la tarea.
6. Como Administrador, firmar verificación `EFFECTIVE` con evidencia objetiva.

**Resultado esperado:** Se genera `CC-YYYY-NNNN`; las combinaciones incompatibles se bloquean y el flujo avanza `PROPOSED` → `ASSESSED` → `APPROVED/IMPLEMENTING` → `PENDING_VERIFICATION` → `CLOSED`.

### QA-CHG-002 — Contraseña incorrecta y cambio inefectivo

**Historia:** Como auditor, quiero asegurar que una firma inválida no avance el cambio y que un resultado inefectivo no se oculte.

**Pasos:**

1. En un segundo cambio, probar una aprobación con contraseña incorrecta.
2. Confirmar que permanece evaluado y firmar correctamente.
3. Completar sus tareas y verificar como `INEFFECTIVE`.

**Resultado esperado:** El intento inválido no cambia el estado y la verificación válida deja el cambio en `VERIFICATION_FAILED` con toda su evidencia.

## 9. Auditorías

### QA-AUD-001 — Auditoría con hallazgo, revisión y cierre

**Historia:** Como Auditor, quiero ejecutar una auditoría y conservar cada respuesta y decisión hasta su cierre independiente.

**Pasos:**

1. Como Auditor, planificar una auditoría interna con él como líder, Revisor de calidad como revisor de cierre y fecha futura.
2. Iniciar la auditoría, registrar un hallazgo `MAJOR` con requisito, evidencia objetiva, Operador responsable y vencimiento futuro.
3. Firmar el informe de ejecución.
4. Como Operador, responder el hallazgo con causa, corrección y acción correctiva.
5. Como Auditor, firmar `REQUEST_REVISION`.
6. Como Operador, enviar un segundo intento.
7. Como Auditor, firmar `ACCEPT`.
8. Como Revisor, firmar el cierre.

**Resultado esperado:** Se generan `AUD-YYYY-NNNN` y hallazgo `-FNN`; el primer intento no se sobrescribe, todos los hallazgos aceptados llevan a `READY_FOR_CLOSURE` y el revisor independiente deja la auditoría `CLOSED`.

### QA-AUD-002 — Restricciones de ejecución

**Historia:** Como responsable de cumplimiento, quiero que sólo el líder ejecute y que el líder no firme su propio cierre.

**Pasos:**

1. Intentar iniciar o reportar hallazgos con un usuario distinto del líder.
2. Intentar usar al mismo líder como revisor de cierre durante la planificación.
3. Intentar cerrar una auditoría que todavía tenga hallazgos abiertos.

**Resultado esperado:** Las tres acciones se bloquean sin alterar el plan ni el historial.

## 10. Riesgos de calidad (FMEA)

### QA-QRM-001 — Mitigación y aceptación independiente

**Historia:** Como Control documental, quiero evaluar un modo de falla y obtener aceptación independiente del riesgo residual.

**Pasos:**

1. Como Control documental, crear una evaluación FMEA `QA - Riesgo de sello`, con Control documental como dueño, Auditor como revisor y un ítem asignado a Operador.
2. Usar severidad 5, probabilidad 4 y detectabilidad 5; comprobar RPN inicial `100`, nivel crítico.
3. Como Operador, firmar la mitigación, evidencia y puntajes residuales 3 × 2 × 2 = `12`.
4. Como Auditor, firmar `ACCEPT` con justificación.

**Resultado esperado:** Se genera `QRM-YYYY-NNNN`; los RPN se calculan correctamente, el último ítem mueve a `PENDING_REVIEW` y la aceptación deja el riesgo `CLOSED`.

### QA-QRM-002 — Revisor no independiente y riesgo no aceptable

**Historia:** Como calidad, quiero impedir la autoaprobación y conservar una disposición residual negativa.

**Pasos:**

1. Intentar crear una FMEA usando como revisor al creador, dueño o mitigador.
2. En una FMEA válida distinta, completar mitigaciones y firmar `NOT_ACCEPTABLE` con Auditor.

**Resultado esperado:** La asignación incompatible se bloquea y el caso válido termina `RESIDUAL_RISK_NOT_ACCEPTED`, sin forzar una reducción artificial del RPN.

## 11. Proveedores y SCAR

### QA-SUP-001 — Calificación inicial y lista aprobada

**Historia:** Como Control documental, quiero calificar un proveedor con decisión independiente.

**Pasos:**

1. Como Control documental, registrar `Proveedor QA de Empaques` con número `REG-QA-001`, criticidad alta y Control documental como dueño de calidad.
2. Firmar evaluación `INITIAL` con puntajes 4, 4, 3 y 4; comprobar resultado `75`.
3. Recomendar aprobación y asignar Auditor como aprobador.
4. Como Auditor, firmar `APPROVE` y establecer reevaluación futura.

**Resultado esperado:** Se genera `SUP-YYYY-NNNN`; la evaluación queda inmutable, la decisión es independiente y el proveedor aparece `APPROVED` en la lista aprobada.

### QA-SUP-002 — SCAR con revisión solicitada

**Historia:** Como dueño de calidad, quiero exigir corrección al proveedor sin perder intentos rechazados.

**Precondición:** El proveedor está aprobado o aprobado condicionalmente.

**Pasos:**

1. Como Control documental, emitir una SCAR mayor con vencimiento futuro y Auditor como revisor.
2. Registrar y firmar una primera respuesta recibida con causa raíz, corrección, acción y referencia de evidencia.
3. Como Auditor, firmar `REQUEST_REVISION`.
4. Como Control documental, registrar una segunda respuesta.
5. Como Auditor, firmar `ACCEPT`.

**Resultado esperado:** Se genera `SCAR-YYYY-NNNN`; ambos intentos permanecen visibles y la aceptación final deja la SCAR `CLOSED`.

## 12. Equipos, calibración y mantenimiento

### QA-EQP-001 — Calibración con verificación independiente

**Historia:** Como Control documental, quiero impedir el uso de un equipo mientras su calibración no haya sido aceptada.

**Pasos:**

1. Registrar `Balanza QA`, categoría `MEASUREMENT`, criticidad alta, Operador como responsable y Auditor como verificador, con planes requeridos.
2. Como Operador, firmar una calibración `PASS` y adjuntar evidencia fotográfica.
3. Comprobar el estado antes de revisión.
4. Como Auditor, firmar `ACCEPT`.

**Resultado esperado:** Se genera `EQP-YYYY-NNNN`; al iniciar/firmar la calibración el equipo queda fuera de servicio o no apto y sólo la aceptación independiente restaura aptitud si los demás planes están vigentes.

### QA-EQP-002 — Mantenimiento rechazado y retiro

**Historia:** Como verificador, quiero mantener fuera de servicio un equipo con intervención insatisfactoria y poder retirarlo definitivamente.

**Pasos:**

1. Como Operador, firmar mantenimiento correctivo `UNSATISFACTORY`.
2. Como Auditor, rechazar la revisión.
3. Confirmar que el equipo sigue fuera de servicio/no apto.
4. Como Auditor, firmar el retiro con contraseña, atestación y motivo.
5. Intentar registrar otra calibración o mantenimiento.

**Resultado esperado:** El rechazo no habilita el equipo; el retiro deja estado `RETIRED`, conserva el historial y bloquea nuevas intervenciones.

## 13. Reclamaciones de producto

### QA-COM-001 — Reclamación con investigación y cierre

**Historia:** Como Operador, quiero reportar una reclamación con evidencia y obtener una disposición independiente.

**Pasos:**

1. Como Operador y desde tablet, crear `QA - Empaque abierto`, fuente cliente, producto/lote definidos, posible evento de seguridad y una foto.
2. Como Aprobador, clasificarla alta, documentar acción inmediata y evaluación regulatoria, asignar Revisor como investigador y Auditor como revisor final.
3. Como Revisor, firmar la investigación, disposición propuesta y vínculos controlados aplicables.
4. Como Auditor, firmar la decisión final con disposición `SUBSTANTIATED` y definir justificadamente si requiere acción de retiro.

**Resultado esperado:** Se conserva el intake y la foto; el flujo pasa `REPORTED` → `UNDER_INVESTIGATION` → `PENDING_REVIEW` → `CLOSED`, con investigador y revisor diferentes.

### QA-COM-002 — Cancelación previa y bloqueo posterior

**Historia:** Como calidad, quiero cancelar sólo duplicados o registros inválidos antes de la clasificación.

**Pasos:**

1. Crear una segunda reclamación de prueba y cancelarla como Aprobador antes del triage, con motivo.
2. En una reclamación ya clasificada, buscar o intentar la acción de cancelación.

**Resultado esperado:** La primera queda `CANCELLED` con intake retenido; la segunda no puede cancelarse por esa vía.

## 14. Retiros y acciones de campo

### QA-RCL-001 — Acción de campo completa

**Historia:** Como organización, quiero evaluar, aprobar, ejecutar y reconciliar una acción de campo con firmas independientes.

**Pasos:**

1. Como Control documental y desde tablet, reportar una acción `RECALL` para el producto/lote definidos, con foto y referencia controlada.
2. Como Revisor, firmar evaluación de peligro, alcance, clase, profundidad, comunicaciones y reporte regulatorio; asignar Auditor como aprobador.
3. Como Auditor, firmar aprobación.
4. Como Operador, agregar actualizaciones acumulativas de inicio, notificaciones, recuperación y comunicación regulatoria.
5. Como Auditor, firmar cierre con efectividad y reconciliación de cantidades.

**Resultado esperado:** Se genera `RCL-YYYY-NNNN`; el flujo avanza `REPORTED` → `PENDING_APPROVAL` → `APPROVED/IN_EXECUTION` → `CLOSED` y ninguna actualización firmada reemplaza otra.

### QA-RCL-002 — Rechazo y operaciones terminales

**Historia:** Como aprobador, quiero que una acción rechazada no pueda ejecutarse ni cerrarse como si hubiera sido aprobada.

**Pasos:**

1. Preparar una segunda acción y firmar la evaluación.
2. Como Auditor, firmar rechazo.
3. Como Operador, intentar añadir una actualización de ejecución.
4. Intentar cerrar o editar el intake.

**Resultado esperado:** El registro queda `REJECTED`; ejecución, cierre y edición posterior se bloquean y la evaluación/decisión permanecen visibles.

## 15. Revisión periódica de producto (PQR/APR)

### QA-PQR-001 — Preparación, tendencias y aprobación

**Historia:** Como Control documental, quiero consolidar una revisión de producto y someterla a aprobación independiente.

**Pasos:**

1. Como Control documental, crear un PQR/APR para `Producto QA 10 mg`, autorización `MA-QA-001`, un periodo pasado no solapado, objetivo futuro y Auditor como aprobador; adjuntar una foto si aplica.
2. Como Operador, preparar lotes, OOS, estabilidad, validación, regulación, beneficio-riesgo y recomendaciones.
3. Firmar la evaluación con contraseña y atestación.
4. Revisar el snapshot de tendencias capturado.
5. Como Auditor, firmar `APPROVE`, racional y próxima revisión.

**Resultado esperado:** El alcance queda inmutable, el snapshot incluye conteos del periodo y comparación anterior, conserva su SHA-256 y el registro termina `APPROVED`.

### QA-PQR-002 — Seguimiento requerido y cancelación temprana

**Historia:** Como aprobador, quiero exigir seguimiento controlado y cancelar sólo borradores incorrectos.

**Pasos:**

1. Preparar un segundo PQR válido y firmar su evaluación.
2. Como Auditor, decidir `REQUIRE_FOLLOW_UP` con razón, referencia controlada y próxima fecha.
3. Crear un tercer borrador incorrecto y cancelarlo antes de evaluación.
4. Intentar cancelar el PQR ya firmado.

**Resultado esperado:** El segundo queda `FOLLOW_UP_REQUIRED`, el tercero `CANCELLED` y el firmado no puede cancelarse ni editarse.

## 16. Evidencia fotográfica, capacidad y tablet

### QA-PHO-001 — Cámara y galería

**Historia:** Como usuario móvil, quiero elegir entre tomar una foto nueva o usar la galería sin perder el formulario.

**Pasos:**

1. Desde una tablet física, abrir formularios de Desviaciones, Reclamaciones, Retiros y PQR/APR.
2. En cada uno, probar `Tomar foto` y cancelar una captura; luego tomarla correctamente.
3. Probar por separado el selector de galería.
4. Completar al menos un registro y dejar otro sin enviar.

**Resultado esperado:** La cámara solicita el entorno trasero cuando el navegador lo permite; cancelar no rompe el formulario; sólo las fotos del registro enviado se almacenan y no se suben archivos del borrador abandonado.

### QA-PHO-002 — Integridad, permisos y cuota

**Historia:** Como administrador, quiero conocer el consumo real y evitar archivos inválidos o accesos no autorizados.

**Pasos:**

1. Anotar el uso de almacenamiento antes de cargar una foto.
2. Cargar un JPEG válido y comprobar que aumenten bytes y cantidad de fotos.
3. Descargar/visualizar la evidencia como un usuario con acceso al registro.
4. Intentar subir un formato no permitido, un archivo vacío o uno superior al límite configurado.
5. Comparar el consumo después del rechazo.

**Resultado esperado:** El uso refleja bytes realmente aceptados; la evidencia válida conserva nombre, tipo, tamaño y SHA-256; los rechazos no consumen cuota. El denominador de capacidad corresponde al límite configurado para el plan/tenant y no al espacio libre del disco.

## 17. Notificaciones, auditoría y consistencia

### QA-XCT-001 — Centro de notificaciones

**Historia:** Como usuario asignado, quiero recibir y gestionar avisos de trabajo próximo, vencido o escalado.

**Pasos:**

1. Crear una asignación o acción con fecha dentro de la ventana de próximo vencimiento.
2. Esperar/ejecutar el monitor correspondiente según la configuración local.
3. Abrir Notificaciones como responsable.
4. Como Aprobador, revisar y reintentar una entrega fallida si se dispone de una.

**Resultado esperado:** Los avisos se deduplican por destinatario, vencimiento y cambio de estado; muestran el registro correcto y un reintento no crea trabajos funcionales duplicados.

### QA-XCT-002 — Persistencia e inmutabilidad

**Historia:** Como auditor, quiero demostrar que las decisiones firmadas sobreviven recargas y no pueden sobrescribirse.

**Pasos:**

1. Elegir una firma completada de documento, CAPA, auditoría, riesgo, proveedor, equipo, reclamación, retiro o PQR.
2. Recargar, cerrar sesión y volver a entrar.
3. Buscar una acción de edición o repetición sobre la firma.
4. Abrir el historial/evento de seguridad disponible.

**Resultado esperado:** Actor, sesión, significado, fecha y huella permanecen; no existe edición autorizada de evidencia final y el intento repetido se rechaza.

### QA-XCT-003 — Concurrencia desde dos pestañas

**Historia:** Como responsable de integridad, quiero que dos decisiones simultáneas produzcan un solo resultado válido.

**Pasos:**

1. Abrir en dos pestañas el mismo registro pendiente con la misma cuenta asignada.
2. Preparar la misma transición en ambas.
3. Enviar la primera y, sin recargar la segunda, enviarla también.
4. Recargar ambas.

**Resultado esperado:** Una sola transición gana; la otra informa conflicto/estado desactualizado y no hay firmas, versiones, respuestas ni secuencias duplicadas.

### QA-XCT-004 — Estado operativo a través de un túnel

**Historia:** Como tester remoto, quiero que el estado del sistema use la URL correcta al exponer frontend y backend.

**Pasos:**

1. Exponer los puertos de frontend y backend con la visibilidad requerida.
2. Desde tablet, abrir directamente la URL pública de `/health/ready` y confirmar `up`.
3. Abrir el frontend con la misma configuración de API.
4. Iniciar sesión y observar el indicador por al menos dos ciclos de sondeo.

**Resultado esperado:** Login y health usan una ruta alcanzable desde la tablet; el indicador permanece operativo y no cambia a degradado por apuntar a `localhost` del dispositivo.

## 18. Administración de usuarios opcional

### QA-USR-001 — Invitación y revocación de acceso

**Historia:** Como Administrador, quiero incorporar a una persona por invitación y revocar su acceso trazablemente.

**Pasos:**

1. Invitar `qa.temp+<fecha>@example.test` con rol Operador.
2. Abrir el correo en el capturador local configurado y completar la activación.
3. Iniciar sesión con el usuario temporal.
4. Como Administrador, cambiarlo a inactivo y comprobar que ya no pueda entrar.

**Resultado esperado:** No existe autoinscripción a la organización; la invitación es de un solo uso, el rol se aplica y la desactivación invalida el acceso.

Este caso crea un séptimo usuario. Ejecutarlo al final y restablecer la línea base después si se necesita volver exactamente a los seis perfiles.

## 19. Ruta crítica recomendada

Si el tiempo es limitado, ejecutar en este orden:

1. `QA-SMK-001`, `QA-AUT-001`, `QA-RBAC-001` y `QA-UX-001`.
2. `QA-DOC-001` a `QA-DOC-003` y `QA-TRN-001`.
3. `QA-DEV-001` a `QA-DEV-003` y `QA-CAPA-001`, `QA-CAPA-002`, `QA-CAPA-004`.
4. `QA-CHG-001`, `QA-AUD-001`, `QA-QRM-001`, `QA-SUP-001`, `QA-EQP-001`.
5. `QA-COM-001`, `QA-RCL-001`, `QA-PQR-001` y `QA-PHO-001`.
6. `QA-XCT-002` y `QA-XCT-003`.

## 20. Registro sugerido de resultados

Por cada ejecución registrar:

| Campo                 | Ejemplo                            |
| --------------------- | ---------------------------------- |
| Caso                  | `QA-DEV-003`                       |
| Resultado             | `PASS`, `FAIL` o `BLOCKED`         |
| Ambiente/commit       | Hash de BE y FE                    |
| Navegador/dispositivo | Edge 140 / iPadOS o Android tablet |
| Actor                 | `controller@qualyra.local`         |
| Código generado       | `DEV-2026-0001`                    |
| Evidencia             | Captura, video corto o export      |
| Resultado observado   | Descripción objetiva               |
| Defecto asociado      | Identificador del issue            |

## 21. Restablecer la línea base local

El siguiente procedimiento **elimina todos los datos funcionales y todas las empresas de la base local**, y recrea únicamente la línea base descrita en este documento. No ejecutarlo contra staging o producción.

1. Detener el backend para evitar escrituras concurrentes.
2. Crear un respaldo con `npm run ops:backup` y conservar el dump y su manifiesto.
3. Desde PowerShell, en el repositorio backend, ejecutar:

```powershell
$env:QA_RESET_CONFIRM = 'RESET_LOCAL_QA'
$env:QA_DEFAULT_PASSWORD = 'QualyraQA2026!'
npm run qa:reset
Remove-Item Env:QA_RESET_CONFIRM
Remove-Item Env:QA_DEFAULT_PASSWORD
```

4. Vaciar sólo el caché Redis local:

```powershell
docker compose exec -T redis redis-cli FLUSHDB
```

5. Iniciar el backend y ejecutar `QA-SMK-001` y `QA-AUT-001`.

El script exige confirmación explícita, una contraseña de 12 a 128 caracteres y una URL de PostgreSQL local. Conserva las migraciones y el catálogo de permisos, restaura los cinco roles del sistema y ejecuta el truncado y la recreación dentro de una transacción.
