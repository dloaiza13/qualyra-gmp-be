# Matriz de acceso por roles

## Principio de autorización

Qualyra aplica mínimo privilegio en dos niveles:

1. El permiso `módulo.read` habilita el módulo y permite consultar únicamente registros efectivos, creados por el usuario, asignados al usuario o en los que participa formalmente.
2. El permiso `módulo.read_all` amplía la consulta a todos los registros de la organización. No concede por sí mismo facultades para crear, firmar, aprobar o cerrar.

Esta validación se ejecuta en el backend para listas, detalles y evidencias. Ocultar opciones en el frontend es una ayuda de navegación, no el control de seguridad principal. Los roles personalizados pueden combinar permisos operativos y `read_all` según el puesto real.

## Roles predeterminados

| Rol                 | Alcance de lectura                                                                    | Responsabilidades predeterminadas                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Administrator       | Todos los registros, usuarios, configuración y plan                                   | Administración completa de la organización; acceso de contingencia                                                                                                             |
| QA Manager          | Todos los procesos y documentos de calidad                                            | Decisiones y firmas de calidad, flujos documentales y capacitación; sin administración de empresa, usuarios o roles                                                            |
| Document Controller | Todos los documentos; sólo registros propios o asignados en otros módulos habilitados | Crear, actualizar, revisar y liberar documentos; publicar guías de ayuda; asignar capacitación; ejecutar CAPA/cambios asignados; responder auditorías y reportar reclamaciones |
| Operator            | Documentos efectivos y registros propios o asignados                                  | Completar capacitación, reportar desviaciones y reclamaciones, ejecutar CAPA/cambios/mitigaciones, responder hallazgos y realizar calibración o mantenimiento asignado         |
| Auditor             | Lectura de todos los procesos y eventos de seguridad                                  | Planificar, ejecutar y revisar auditorías; exportar evidencia CAPA; sin aprobar operaciones que audita                                                                         |

## Alcance por módulo

| Módulo                         | Administrator | QA Manager                 | Document Controller            | Operator                       | Auditor                             |
| ------------------------------ | ------------- | -------------------------- | ------------------------------ | ------------------------------ | ----------------------------------- |
| Plan y uso                     | Administrar   | —                          | —                              | —                              | —                                   |
| Usuarios, invitaciones y roles | Administrar   | —                          | —                              | —                              | —                                   |
| Documentos                     | Todo          | Crear, revisar y aprobar   | Crear, revisar y liberar       | Efectivos/asignados            | Lectura total                       |
| Capacitación                   | Todo          | Asignar y completar propia | Asignar y completar propia     | Completar propia               | Completar propia                    |
| Desviaciones                   | Todo          | Todo                       | —                              | Reportar y consultar propias   | Lectura total                       |
| CAPA                           | Todo          | Todo                       | Ejecutar asignadas             | Ejecutar asignadas             | Lectura total y exportación         |
| Control de cambios             | Todo          | Todo                       | Proponer/implementar asignados | Proponer/implementar asignados | Lectura total                       |
| Auditorías                     | Todo          | Todo                       | Responder hallazgos asignados  | Responder hallazgos asignados  | Planificar, ejecutar y revisar      |
| Riesgos                        | Todo          | Todo                       | —                              | Mitigar asignados              | Lectura total                       |
| Proveedores                    | Todo          | Todo                       | —                              | —                              | Lectura total                       |
| Equipos                        | Todo          | Todo                       | —                              | Calibrar/mantener asignados    | Lectura total                       |
| Reclamaciones                  | Todo          | Todo                       | Reportar y consultar propias   | Reportar y consultar propias   | Lectura total                       |
| Retiros/acciones de campo      | Todo          | Todo                       | —                              | —                              | Lectura total                       |
| PQR/APR                        | Todo          | Todo                       | —                              | —                              | Lectura total                       |
| Seguridad/notificaciones       | Todo          | Notificaciones             | —                              | —                              | Lectura de eventos y notificaciones |
| Guías de ayuda                 | Administrar   | Lectura                    | Administrar                    | Lectura                        | Lectura                             |

`—` significa que el rol no recibe el módulo de forma predeterminada. Un Administrador puede crear roles personalizados para responsabilidades de calidad, manteniendo segregación de funciones. Los permisos de empresa, usuarios, invitaciones y roles están reservados de forma permanente al rol `Administrator` y no aparecen en el catálogo asignable.

## Reglas de registros asignados

- Documentos: versiones efectivas y documentos donde el usuario es dueño, creador, revisor, aprobador o revisor periódico.
- Desviaciones y reclamaciones: registros reportados, clasificados, investigados o revisados por el usuario.
- CAPA, cambios, auditorías y riesgos: registros creados por el usuario o con acciones, tareas, hallazgos, revisiones o mitigaciones asignadas.
- Proveedores, equipos, retiros y PQR/APR: registros donde el usuario tiene una responsabilidad formal registrada.
- Evidencia fotográfica y archivos CAPA: heredan el acceso del registro padre. Conocer el identificador de un archivo no evita la validación.

## Criterios para personalizar roles

- Dar `read_all` sólo a puestos con necesidad transversal de supervisión o auditoría.
- Separar creación, ejecución y aprobación cuando el proceso exige independencia.
- Evitar usar Administrator para trabajo cotidiano; reservarlo para administración y contingencia.
- Revisar roles al cambiar de puesto y conservar identidades separadas para pruebas de segregación.
- Validar cualquier rol personalizado con una prueba positiva y otra negativa de acceso directo a la API.
