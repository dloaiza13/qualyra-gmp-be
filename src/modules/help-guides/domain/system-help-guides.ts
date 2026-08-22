import type { HelpGuideContext } from '../../../generated/prisma/client.js';

export interface SystemHelpGuide {
  key: string;
  source: 'SYSTEM';
  context: HelpGuideContext;
  slug: string;
  sortOrder: number;
  version: number;
  titleEs: string;
  titleEn: string;
  summaryEs: string;
  summaryEn: string;
  stepsEs: string[];
  stepsEn: string[];
  mediaUrl: null;
  videoUrl: null;
  resourceLabelEs: null;
  resourceLabelEn: null;
  resourceUrl: null;
}

function guide(
  context: HelpGuideContext,
  slug: string,
  titleEs: string,
  titleEn: string,
  summaryEs: string,
  summaryEn: string,
  stepsEs: string[],
  stepsEn: string[],
): SystemHelpGuide {
  return {
    key: `system:${slug}`,
    source: 'SYSTEM',
    context,
    slug,
    sortOrder: 1000,
    version: 1,
    titleEs,
    titleEn,
    summaryEs,
    summaryEn,
    stepsEs,
    stepsEn,
    mediaUrl: null,
    videoUrl: null,
    resourceLabelEs: null,
    resourceLabelEn: null,
    resourceUrl: null,
  };
}

export const systemHelpGuides: readonly SystemHelpGuide[] = [
  guide(
    'OVERVIEW',
    'overview',
    'Cómo orientarte en Qualyra',
    'Getting around Qualyra',
    'Usa el menú para entrar a cada proceso y el panel de ayuda para consultar instrucciones sin abandonar tu trabajo.',
    'Use the menu to open each process and the help panel to consult instructions without leaving your work.',
    [
      'Revisa el resumen para identificar tareas y procesos disponibles según tu rol.',
      'Abre un módulo desde el menú izquierdo; sólo aparecerán las funciones autorizadas para tu cuenta.',
      'Pulsa Ayuda en cualquier pantalla para ver la guía correspondiente.',
      'Si una acción requiere firma, confirma el significado y vuelve a autenticarte con tu contraseña.',
    ],
    [
      'Review the overview to identify tasks and processes available for your role.',
      'Open a module from the left menu; only functions authorized for your account are shown.',
      'Select Help on any screen to view its contextual guide.',
      'When an action requires a signature, confirm its meaning and reauthenticate with your password.',
    ],
  ),
  guide(
    'DOCUMENTS',
    'documents',
    'Cómo gestionar documentos controlados',
    'Managing controlled documents',
    'Crea, revisa, aprueba y libera documentos conservando versión, responsables y evidencia de cada decisión.',
    'Create, review, approve, and release documents while preserving versions, responsibilities, and decision evidence.',
    [
      'Crea el documento con su código, tipo, propietario y contenido inicial.',
      'Asigna personas diferentes para revisión y aprobación cuando el flujo lo requiera.',
      'Atiende observaciones mediante una nueva versión; no sustituyas evidencia ya decidida.',
      'Libera la versión aprobada mediante la firma solicitada y verifica que figure como vigente.',
      'Asocia capacitación o revisión periódica cuando aplique al procedimiento.',
    ],
    [
      'Create the document with its code, type, owner, and initial content.',
      'Assign different people for review and approval when required by the workflow.',
      'Address observations through a new version; do not replace decided evidence.',
      'Release the approved version with the requested signature and verify that it is effective.',
      'Link training or a periodic review when applicable to the procedure.',
    ],
  ),
  guide(
    'TRAINING',
    'training',
    'Cómo completar capacitaciones',
    'Completing training',
    'Consulta asignaciones vinculadas a documentos vigentes y registra una lectura atribuible.',
    'Review assignments linked to effective documents and record attributable acknowledgement.',
    [
      'Abre la capacitación pendiente y confirma el documento y la versión asignados.',
      'Lee el contenido completo antes de registrar la finalización.',
      'Confirma la declaración de lectura y autentícate cuando el sistema lo solicite.',
      'Verifica que la asignación quede completada con fecha, usuario y versión.',
    ],
    [
      'Open the pending assignment and confirm the assigned document and version.',
      'Read the complete content before recording completion.',
      'Confirm the acknowledgement and authenticate when prompted.',
      'Verify that the assignment is completed with its date, user, and version.',
    ],
  ),
  guide(
    'DEVIATIONS',
    'deviations',
    'Cómo gestionar una desviación',
    'Managing a deviation',
    'Registra el evento, realiza el triage y documenta una investigación de causa raíz completa y trazable.',
    'Record the event, perform triage, and document a complete, traceable root-cause investigation.',
    [
      'Reporta qué ocurrió, dónde, cuándo, el impacto observado y la contención inmediata.',
      'Durante el triage clasifica la severidad y asigna un investigador competente.',
      'El investigador documenta hechos, metodología, causa raíz y conclusión antes de firmar.',
      'Si la investigación requiere CAPA, crea el plan desde la causa raíz confirmada.',
      'Comprueba el cierre sólo después de completar las acciones y verificar su eficacia.',
    ],
    [
      'Report what happened, where and when it occurred, its observed impact, and immediate containment.',
      'During triage, classify severity and assign a qualified investigator.',
      'The investigator documents facts, method, root cause, and conclusion before signing.',
      'When the investigation requires CAPA, create the plan from the confirmed root cause.',
      'Confirm closure only after actions are complete and effectiveness is verified.',
    ],
  ),
  guide(
    'CAPAS',
    'capas',
    'Cómo gestionar un plan CAPA',
    'Managing a CAPA plan',
    'Convierte una causa raíz confirmada en acciones medibles, responsables y una verificación independiente.',
    'Turn a confirmed root cause into measurable actions, accountable owners, and independent verification.',
    [
      'Selecciona la desviación investigada y define el objetivo del plan.',
      'Crea acciones correctivas o preventivas con responsable y fecha objetivo realista.',
      'Cada responsable completa únicamente sus acciones y adjunta la evidencia correspondiente.',
      'Programa la verificación con un revisor independiente de quienes ejecutaron las acciones.',
      'Si el resultado es ineficaz, abre el seguimiento requerido en lugar de forzar el cierre.',
    ],
    [
      'Select the investigated deviation and define the plan objective.',
      'Create corrective or preventive actions with an owner and realistic target date.',
      'Each owner completes only assigned actions and attaches the corresponding evidence.',
      'Schedule verification with a reviewer independent from action executors.',
      'If the outcome is ineffective, open the required follow-up instead of forcing closure.',
    ],
  ),
  guide(
    'CHANGES',
    'changes',
    'Cómo controlar un cambio',
    'Controlling a change',
    'Evalúa impacto y riesgo antes de aprobar, implementar y verificar cualquier cambio GMP.',
    'Assess impact and risk before approving, implementing, and verifying any GMP change.',
    [
      'Describe la situación actual, el cambio propuesto y su justificación.',
      'Evalúa impactos GMP, riesgo, documentos, capacitación y validación necesaria.',
      'Obtén una decisión independiente antes de iniciar tareas de implementación.',
      'Completa cada tarea con evidencia y registra desviaciones si el plan no se cumple.',
      'Verifica la eficacia de forma independiente antes del cierre.',
    ],
    [
      'Describe the current state, proposed change, and justification.',
      'Assess GMP impacts, risk, documents, training, and required validation.',
      'Obtain an independent decision before starting implementation tasks.',
      'Complete each task with evidence and record deviations when the plan is not followed.',
      'Verify effectiveness independently before closure.',
    ],
  ),
  guide(
    'AUDITS',
    'audits',
    'Cómo gestionar una auditoría',
    'Managing an audit',
    'Planifica el alcance, conserva evidencia objetiva y controla respuestas y cierre de hallazgos.',
    'Plan the scope, preserve objective evidence, and control finding responses and closure.',
    [
      'Define tipo, alcance, criterios, fechas y participantes independientes.',
      'Durante la ejecución registra evidencia objetiva y clasifica cada hallazgo.',
      'Asigna responsables y plazos para responder los hallazgos.',
      'Revisa las respuestas y su evidencia sin sustituir la responsabilidad del auditado.',
      'Firma el cierre únicamente cuando todos los hallazgos estén resueltos.',
    ],
    [
      'Define type, scope, criteria, dates, and independent participants.',
      'During execution, record objective evidence and classify each finding.',
      'Assign owners and deadlines for finding responses.',
      'Review responses and evidence without replacing the auditee’s responsibility.',
      'Sign closure only when all findings are resolved.',
    ],
  ),
  guide(
    'RISKS',
    'risks',
    'Cómo evaluar riesgos de calidad',
    'Assessing quality risks',
    'Usa FMEA para evaluar fallos, ejecutar mitigaciones y aceptar el riesgo residual de forma independiente.',
    'Use FMEA to assess failures, execute mitigations, and independently accept residual risk.',
    [
      'Define el proceso, producto o sistema evaluado y asigna participantes competentes.',
      'Describe cada modo de fallo, efecto, causa y controles existentes.',
      'Valora severidad, ocurrencia y detectabilidad con criterios consistentes.',
      'Ejecuta y documenta mitigaciones para los riesgos no aceptables.',
      'Un revisor independiente decide sobre el riesgo residual y firma la evaluación.',
    ],
    [
      'Define the assessed process, product, or system and assign qualified participants.',
      'Describe each failure mode, effect, cause, and existing controls.',
      'Rate severity, occurrence, and detectability using consistent criteria.',
      'Execute and document mitigations for unacceptable risks.',
      'An independent reviewer decides on residual risk and signs the assessment.',
    ],
  ),
  guide(
    'SUPPLIERS',
    'suppliers',
    'Cómo gestionar proveedores',
    'Managing suppliers',
    'Mantén la ficha del proveedor, su calificación y las acciones SCAR con decisiones independientes.',
    'Maintain the supplier record, qualification, and SCAR actions with independent decisions.',
    [
      'Registra datos, categoría, criticidad, alcance y responsables del proveedor.',
      'Completa la evaluación con criterios y evidencia verificable.',
      'Obtén una decisión independiente de aprobación o descalificación.',
      'Emite una SCAR cuando corresponda y controla respuesta, evidencia y revisión.',
    ],
    [
      'Record supplier data, category, criticality, scope, and responsible parties.',
      'Complete the assessment with criteria and verifiable evidence.',
      'Obtain an independent approval or disqualification decision.',
      'Issue a SCAR when needed and control its response, evidence, and review.',
    ],
  ),
  guide(
    'EQUIPMENT',
    'equipment',
    'Cómo gestionar equipos GMP',
    'Managing GMP equipment',
    'Controla el estado del equipo y conserva evidencia de calibraciones, mantenimientos y revisiones.',
    'Control equipment status and preserve calibration, maintenance, and review evidence.',
    [
      'Crea la ficha con identificación, ubicación, uso, criticidad y responsables.',
      'Define frecuencias de calibración y mantenimiento según el riesgo.',
      'Registra cada servicio con referencias, resultados y evidencia.',
      'Solicita revisión independiente de los registros completados.',
      'Retira el equipo sólo después de resolver servicios pendientes.',
    ],
    [
      'Create the record with identification, location, use, criticality, and owners.',
      'Define calibration and maintenance frequencies according to risk.',
      'Record each service with references, results, and evidence.',
      'Request independent review of completed records.',
      'Retire equipment only after pending services are resolved.',
    ],
  ),
  guide(
    'COMPLAINTS',
    'complaints',
    'Cómo gestionar una reclamación',
    'Managing a complaint',
    'Conserva la información recibida, evalúa seguridad y reportabilidad, investiga y decide independientemente.',
    'Preserve received information, assess safety and reportability, investigate, and decide independently.',
    [
      'Registra el producto, lote, origen, descripción y datos disponibles del reclamante.',
      'Realiza el triage de severidad, seguridad del paciente y posible reportabilidad.',
      'Asigna investigador y revisor diferentes.',
      'Documenta investigación, muestras, causa y evaluación del impacto.',
      'El revisor firma la disposición final y escala a retiro cuando corresponda.',
    ],
    [
      'Record product, batch, source, description, and available complainant information.',
      'Triage severity, patient safety, and potential reportability.',
      'Assign different investigator and reviewer identities.',
      'Document the investigation, samples, cause, and impact assessment.',
      'The reviewer signs final disposition and escalates to recall when applicable.',
    ],
  ),
  guide(
    'RECALLS',
    'recalls',
    'Cómo gestionar retiros y acciones de campo',
    'Managing recalls and field actions',
    'Evalúa, aprueba, ejecuta y reconcilia acciones de campo con evidencia cronológica.',
    'Assess, approve, execute, and reconcile field actions with chronological evidence.',
    [
      'Registra producto, lotes, mercados, motivo y origen de la señal.',
      'Completa la evaluación de riesgo y propone clasificación, profundidad y estrategia.',
      'Obtén una decisión independiente antes de ejecutar la acción.',
      'Añade actualizaciones cronológicas de notificación, recuperación y reconciliación.',
      'Firma el cierre al demostrar cantidades y eficacia de la acción.',
    ],
    [
      'Record product, batches, markets, reason, and signal source.',
      'Complete the risk assessment and propose classification, depth, and strategy.',
      'Obtain an independent decision before executing the action.',
      'Add chronological notification, recovery, and reconciliation updates.',
      'Sign closure after demonstrating quantities and action effectiveness.',
    ],
  ),
  guide(
    'PRODUCT_REVIEWS',
    'product-reviews',
    'Cómo preparar una revisión PQR/APR',
    'Preparing a PQR/APR',
    'Define el periodo y producto, analiza tendencias y conserva una instantánea firmada para aprobación.',
    'Define the period and product, analyze trends, and preserve a signed snapshot for approval.',
    [
      'Crea el alcance con producto, presentación, sitio y periodo cerrado.',
      'Revisa tendencias de lotes, desviaciones, CAPA, reclamaciones, cambios y estabilidad.',
      'Documenta conclusiones, riesgos, acciones recomendadas y evaluación del estado validado.',
      'Firma la evaluación para congelar la instantánea analizada.',
      'Un aprobador independiente revisa y firma la decisión final.',
    ],
    [
      'Create the scope with product, presentation, site, and closed period.',
      'Review trends for batches, deviations, CAPA, complaints, changes, and stability.',
      'Document conclusions, risks, recommended actions, and validated-state assessment.',
      'Sign the assessment to freeze the analyzed snapshot.',
      'An independent approver reviews and signs the final decision.',
    ],
  ),
];

export function systemGuideByKey(key: string): SystemHelpGuide | undefined {
  return systemHelpGuides.find((item) => item.key === key);
}
