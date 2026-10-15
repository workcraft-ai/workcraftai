import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = "https://workcraftai.com";
const appUrl = "https://app.workcraftai.com/signup";
const lastmod = process.env.SITEMAP_LASTMOD ?? new Date().toISOString().slice(0, 10);

const trades = [
  {
    key: "landscaping",
    enPath: "estimates/landscaping",
    esPath: "es/cotizaciones/paisajismo",
    guide: "price-a-small-trade-job",
    en: {
      trade: "Landscaping",
      title: "Landscaping Estimate Software for Clear, Itemized Quotes | WorkCraft AI",
      description: "Create landscaping estimates on your phone. Organize site prep, planting, materials, and cleanup into a clear customer proposal.",
      h1: "Create a clear landscaping estimate before work begins.",
      intro: "Turn a property walk-through into a practical written scope. WorkCraft AI helps independent landscapers organize quantities, tasks, and their own rates, then share a customer-ready proposal link.",
      focusTitle: "Build the estimate around the property",
      focus: [
        ["Record the site conditions", "Note access, slope, drainage, existing plants, utilities, and what the customer wants to keep."],
        ["Separate preparation from installation", "Show clearing, grading, soil work, planting, irrigation, and hauling as distinct scope items when they are priced separately."],
        ["State the finish and care", "Describe plant sizes, mulch depth, seed or sod type, watering responsibility, and cleanup expectations."],
      ],
      examplesTitle: "Landscaping line item examples",
      examplesIntro: "Use these as scope labels and unit ideas. They are not local prices; enter rates that match your labor, materials, overhead, and market.",
      items: [
        ["Site clearing and bed preparation", "sq. ft. or job", "Identify what is removed and where debris goes."],
        ["Soil, compost, or mulch placement", "cubic yard", "State material, depth, and delivery assumptions."],
        ["Plant installation", "each", "List plant type, size, and quantity or attach a planting schedule."],
        ["Sod or seed installation", "sq. ft.", "Specify turf or seed, soil preparation, and watering handoff."],
        ["Irrigation adjustment", "zone or hour", "Describe the zones or components being changed."],
        ["Final cleanup and haul-away", "job", "Clarify disposal location and any dump fees."],
      ],
      checklistTitle: "Details to confirm before sending",
      checklist: [
        "Measure each bed, lawn area, path, and work zone; note how measurements were taken.",
        "Confirm gate width, equipment access, parking, slope, drainage, and underground utility marking.",
        "List plant varieties and sizes, material quantities, delivery, and any customer-supplied items.",
        "Define watering, maintenance, weather delays, disposal, and work that is outside the scope.",
      ],
      closeTitle: "Keep the quote useful after the site visit",
      close: "A good landscaping estimate makes the visible work and the assumptions easy to review. Add quantities and units where they help, keep optional upgrades separate, and review your own rates before sharing. WorkCraft AI lets you build estimates from a phone, reuse price book items, and share a proposal link customers can review without creating an account.",
      faq: [
        ["Does WorkCraft AI provide local landscaping prices?", "No. Example line items are for organizing scope, not quoting market rates. You set and review your own prices."],
        ["Can I show materials and labor separately?", "Yes. Add separate estimate items when that makes the scope and price easier for your customer to understand."],
      ],
      cta: "Create a landscaping estimate",
      related: "Read the guide to pricing a small trade job",
      crumbHome: "Home",
      crumbTrade: "Landscaping estimates",
      label: "Estimate software for landscapers",
      note: "Scope examples only · add your own rates",
    },
    es: {
      trade: "Paisajismo",
      title: "Software para cotizaciones de paisajismo claras | WorkCraft AI",
      description: "Crea cotizaciones de paisajismo desde tu teléfono. Organiza preparación, plantas, materiales y limpieza en una propuesta clara.",
      h1: "Prepara una cotización de paisajismo clara antes de empezar.",
      intro: "Convierte el recorrido por la propiedad en un alcance práctico por escrito. WorkCraft AI ayuda a contratistas independientes de paisajismo a organizar cantidades, tareas y sus propias tarifas, y luego compartir una propuesta para el cliente.",
      focusTitle: "Organiza la cotización según la propiedad",
      focus: [
        ["Anota las condiciones del sitio", "Registra acceso, pendiente, drenaje, plantas existentes, servicios subterráneos y qué desea conservar el cliente."],
        ["Separa la preparación de la instalación", "Detalla limpieza, nivelación, preparación del suelo, plantación, riego y retiro de residuos cuando se coticen por separado."],
        ["Describe el resultado y el cuidado", "Especifica el tamaño de las plantas, grosor del mantillo, tipo de semilla o césped, responsabilidad de riego y limpieza final."],
      ],
      examplesTitle: "Ejemplos de partidas de paisajismo",
      examplesIntro: "Úsalos como nombres de alcance y posibles unidades. No son precios locales: ingresa tarifas que reflejen tu mano de obra, materiales, gastos y mercado.",
      items: [
        ["Limpieza del sitio y preparación de camas", "pie² o trabajo", "Indica qué se retira y adónde van los residuos."],
        ["Colocación de tierra, composta o mantillo", "yarda cúbica", "Especifica el material, la profundidad y la entrega."],
        ["Instalación de plantas", "cada una", "Indica tipo, tamaño y cantidad, o adjunta una lista de plantación."],
        ["Instalación de césped o semilla", "pie²", "Especifica el tipo de césped o semilla, la preparación y el cuidado inicial."],
        ["Ajuste del sistema de riego", "zona u hora", "Describe las zonas o componentes que se modificarán."],
        ["Limpieza final y retiro de residuos", "trabajo", "Aclara el lugar de disposición y cualquier cargo del vertedero."],
      ],
      checklistTitle: "Confirma estos detalles antes de enviar",
      checklist: [
        "Mide cada cama, área de césped, sendero y zona de trabajo; anota cómo se midió.",
        "Confirma el ancho de los accesos, estacionamiento, pendiente, drenaje y ubicación de servicios subterráneos.",
        "Indica variedades y tamaños de plantas, cantidades de materiales, entrega y artículos que aporta el cliente.",
        "Define riego, mantenimiento, demoras por clima, disposición de residuos y trabajos excluidos."],
      closeTitle: "Mantén la cotización útil después de la visita",
      close: "Una buena cotización de paisajismo facilita revisar el trabajo visible y sus supuestos. Incluye cantidades y unidades cuando ayuden, separa las mejoras opcionales y revisa tus tarifas antes de compartir. Con WorkCraft AI puedes crear cotizaciones desde el teléfono, reutilizar artículos de tu lista de precios y compartir un enlace que el cliente puede revisar sin crear una cuenta.",
      faq: [
        ["¿WorkCraft AI incluye precios locales de paisajismo?", "No. Las partidas de ejemplo sirven para organizar el alcance, no para indicar tarifas de mercado. Tú defines y revisas tus precios."],
        ["¿Puedo separar materiales y mano de obra?", "Sí. Agrega partidas separadas cuando eso facilite explicar el alcance y el precio al cliente."],
      ],
      cta: "Crear una cotización de paisajismo",
      related: "Lee la guía para calcular el precio de un trabajo pequeño",
      crumbHome: "Inicio",
      crumbTrade: "Cotizaciones de paisajismo",
      label: "Software de cotizaciones para paisajistas",
      note: "Ejemplos de alcance · agrega tus propias tarifas",
    },
  },
  {
    key: "plumbing",
    enPath: "estimates/plumbing",
    esPath: "es/cotizaciones/plomeria",
    guide: "plumbing-estimate-example",
    en: {
      trade: "Plumbing",
      title: "Plumbing Estimate Software for Itemized Quotes | WorkCraft AI",
      description: "Build plumbing estimates from your phone. Separate diagnosis, parts, installation, access work, testing, and cleanup for customers.",
      h1: "Write a plumbing estimate customers can follow.",
      intro: "A plumbing quote is easier to approve when the customer can see what is being repaired or installed, what access is needed, and how the work will be tested. WorkCraft AI gives solo plumbers and small shops one place to build and share that scope.",
      focusTitle: "Make the repair path clear",
      focus: [
        ["Describe the observed issue", "Record the fixture, location, symptoms, and diagnostic limits; distinguish confirmed repairs from concealed conditions."],
        ["Break out work and materials", "Separate labor, fixtures, valves, piping, fittings, access, and disposal when the distinction helps explain the price."],
        ["Include testing and restoration", "State pressure or leak testing, fixture checks, patching, and cleanup that are included or excluded."],
      ],
      examplesTitle: "Plumbing line item examples",
      examplesIntro: "These examples organize common scope components. They are not pricing guidance; use your own current labor and material rates.",
      items: [
        ["Service call and diagnosis", "visit or hour", "State the inspection included and whether further diagnostics are separate."],
        ["Fixture replacement", "each", "Name the fixture, included trim, and who supplies it."],
        ["Supply line, shutoff, or valve replacement", "each", "Identify location, material, and included access."],
        ["Pipe repair or replacement", "linear ft. or job", "Describe the accessible section and tie-in points."],
        ["Leak or pressure test", "system or job", "State the test performed and acceptance condition."],
        ["Wall access and patch allowance", "opening or allowance", "Explain finish repair limits and approval for concealed damage."],
      ],
      checklistTitle: "Details to confirm before sending",
      checklist: [
        "Identify the affected fixture or system and the limits of what was visible during inspection.",
        "Confirm water shutoff, access, occupied-space protection, permits, and fixture selection.",
        "List included parts, finish materials, disposal, testing, and any customer-supplied equipment.",
        "Explain how hidden damage, code-required changes, or added repairs will be approved and priced."],
      closeTitle: "Separate confirmed work from unknown conditions",
      close: "For repairs behind walls or under slabs, describe what is known and how additional work will be handled before it begins. Keep optional replacements separate from the required repair. WorkCraft AI helps plumbers prepare an itemized estimate, reuse common price book items, and share a proposal link from the job site.",
      faq: [
        ["Should a plumbing quote include a diagnostic fee?", "If you charge one, show it as a separate item and state what it covers. Use your own policy and rates."],
        ["How should I describe concealed damage?", "Note what could not be inspected, set a clear approval process for added work, and avoid presenting an allowance as a guaranteed final cost."],
      ],
      cta: "Create a plumbing estimate",
      related: "See a sample plumbing estimate scope",
      crumbHome: "Home",
      crumbTrade: "Plumbing estimates",
      label: "Estimate software for plumbers",
      note: "Scope examples only · add your own rates",
    },
    es: {
      trade: "Plomería",
      title: "Software para cotizaciones de plomería por partidas | WorkCraft AI",
      description: "Prepara cotizaciones de plomería desde el teléfono. Separa diagnóstico, piezas, instalación, acceso, pruebas y limpieza.",
      h1: "Prepara una cotización de plomería fácil de entender.",
      intro: "Es más fácil aprobar una cotización cuando el cliente entiende qué se reparará o instalará, qué acceso se necesita y cómo se probará el trabajo. WorkCraft AI ofrece a plomeros independientes y negocios pequeños un lugar para preparar y compartir el alcance.",
      focusTitle: "Explica con claridad el proceso de reparación",
      focus: [
        ["Describe el problema observado", "Registra el accesorio, ubicación, síntomas y límites del diagnóstico; separa las reparaciones confirmadas de las condiciones ocultas."],
        ["Desglosa el trabajo y los materiales", "Separa mano de obra, accesorios, válvulas, tubería, conexiones, acceso y disposición cuando eso ayude a explicar el precio."],
        ["Incluye las pruebas y la restauración", "Indica las pruebas de presión o fugas, revisión del accesorio, parches y limpieza incluidos o excluidos."],
      ],
      examplesTitle: "Ejemplos de partidas de plomería",
      examplesIntro: "Estos ejemplos ayudan a organizar los componentes del alcance. No son precios recomendados; usa tus tarifas actuales de mano de obra y materiales.",
      items: [
        ["Visita de servicio y diagnóstico", "visita u hora", "Indica qué inspección incluye y si se cobran aparte otras pruebas."],
        ["Reemplazo de accesorio", "cada uno", "Nombra el accesorio, los acabados incluidos y quién lo suministra."],
        ["Reemplazo de línea de suministro, llave o válvula", "cada uno", "Indica la ubicación, el material y el acceso incluido."],
        ["Reparación o reemplazo de tubería", "pie lineal o trabajo", "Describe la sección accesible y los puntos de conexión."],
        ["Prueba de fugas o presión", "sistema o trabajo", "Indica la prueba realizada y el resultado esperado."],
        ["Acceso a pared y provisión para parche", "abertura o provisión", "Explica los límites de acabado y cómo aprobar daños ocultos."],
      ],
      checklistTitle: "Confirma estos detalles antes de enviar",
      checklist: [
        "Identifica el accesorio o sistema afectado y los límites de lo visible durante la inspección.",
        "Confirma el cierre del agua, acceso, protección del espacio, permisos y selección del accesorio.",
        "Enumera piezas, acabados, disposición, pruebas y equipos que aporta el cliente.",
        "Explica cómo se aprobarán y cotizarán los daños ocultos, cambios de código o reparaciones adicionales."],
      closeTitle: "Distingue el trabajo confirmado de las condiciones desconocidas",
      close: "En reparaciones detrás de paredes o bajo losas, indica lo que se conoce y cómo se manejará el trabajo adicional antes de empezarlo. Mantén las mejoras opcionales separadas de la reparación necesaria. WorkCraft AI ayuda a preparar cotizaciones detalladas, reutilizar artículos de la lista de precios y compartir propuestas desde el sitio de trabajo.",
      faq: [
        ["¿La cotización debe incluir el cargo de diagnóstico?", "Si lo cobras, muéstralo como una partida separada e indica qué cubre. Usa tus propias políticas y tarifas."],
        ["¿Cómo describo los daños ocultos?", "Indica lo que no se pudo inspeccionar, define cómo se aprobará el trabajo adicional y no presentes una provisión como costo final garantizado."],
      ],
      cta: "Crear una cotización de plomería",
      related: "Consulta un ejemplo de alcance para plomería",
      crumbHome: "Inicio",
      crumbTrade: "Cotizaciones de plomería",
      label: "Software de cotizaciones para plomeros",
      note: "Ejemplos de alcance · agrega tus propias tarifas",
    },
  },
  {
    key: "electrical",
    enPath: "estimates/electrical",
    esPath: "es/cotizaciones/electricidad",
    guide: "electrical-estimate-checklist",
    en: {
      trade: "Electrical",
      title: "Electrical Estimate Software for Clear Customer Quotes | WorkCraft AI",
      description: "Create electrical estimates on mobile. Organize devices, circuits, materials, access, permits, testing, and clear exclusions.",
      h1: "Turn an electrical walk-through into a clear estimate.",
      intro: "Customers need to know which devices, circuits, or equipment are included—and what conditions could change the work. WorkCraft AI helps independent electricians organize scope and rates into a proposal they can share from the field.",
      focusTitle: "Show what is included in the electrical work",
      focus: [
        ["Name each device or system", "Describe outlets, lighting, breakers, circuits, panels, and the locations served instead of relying on a vague labor line."],
        ["Call out access and finish work", "Note wall or ceiling access, conduit or cable routing, patching, painting, and whether those tasks are included."],
        ["Document verification", "State the tests, labeling, startup, and cleanup included, along with permit assumptions and exclusions."],
      ],
      examplesTitle: "Electrical line item examples",
      examplesIntro: "Use these as scope prompts, not suggested rates. Enter your own pricing and confirm all work follows applicable code and licensing requirements.",
      items: [
        ["Electrical service diagnosis", "visit or hour", "Describe the symptom checked and the diagnostic limit."],
        ["Outlet, switch, or fixture installation", "each", "Specify device type, location, and finish requirements."],
        ["New branch circuit", "circuit", "Identify the served load, route assumptions, and panel capacity check."],
        ["Conduit or cable installation", "linear ft. or job", "Note pathway, surface, and included supports or terminations."],
        ["Panel or breaker work", "each or job", "List components and any required shutdown or inspection coordination."],
        ["Testing, labeling, and cleanup", "job", "State verification and closeout steps included."],
      ],
      checklistTitle: "Details to confirm before sending",
      checklist: [
        "Confirm device locations, quantities, circuit requirements, and the equipment being served.",
        "Check access, existing wiring condition, panel capacity, routing, and finish repair boundaries.",
        "Identify permit, inspection, outage, and customer-provided fixture assumptions.",
        "State testing, labeling, cleanup, and the process for handling concealed or code-required work."],
      closeTitle: "Describe the work in customer language",
      close: "A line item such as “electrical labor” leaves room for confusion. Name the device or circuit, its location, and the finish work included. Keep uncertain conditions visible and get customer approval before adding scope. WorkCraft AI lets electricians assemble estimate items, reuse their own price book, and share a review link.",
      faq: [
        ["Should material and installation labor be separate?", "Separate them when it makes your pricing or customer choices clearer; otherwise describe what the combined line includes."],
        ["Do the examples include permit costs?", "No. Permit and inspection requirements vary by location and project. Verify local requirements and add your own applicable costs."],
      ],
      cta: "Create an electrical estimate",
      related: "Use the electrical estimate checklist",
      crumbHome: "Home",
      crumbTrade: "Electrical estimates",
      label: "Estimate software for electricians",
      note: "Scope examples only · add your own rates",
    },
    es: {
      trade: "Electricidad",
      title: "Software para cotizaciones eléctricas claras | WorkCraft AI",
      description: "Crea cotizaciones eléctricas desde el móvil. Organiza dispositivos, circuitos, materiales, acceso, permisos y pruebas.",
      h1: "Convierte una inspección eléctrica en una cotización clara.",
      intro: "El cliente necesita saber qué dispositivos, circuitos o equipos están incluidos y qué condiciones podrían cambiar el trabajo. WorkCraft AI ayuda a electricistas independientes a organizar el alcance y sus tarifas en una propuesta que pueden compartir desde el sitio.",
      focusTitle: "Indica qué incluye el trabajo eléctrico",
      focus: [
        ["Nombra cada dispositivo o sistema", "Describe tomacorrientes, iluminación, interruptores, circuitos, paneles y ubicaciones en vez de usar una partida vaga de mano de obra."],
        ["Aclara acceso y acabados", "Indica el acceso a paredes o techos, rutas de conductos o cables, parches, pintura y si esas tareas están incluidas."],
        ["Documenta la verificación", "Especifica pruebas, rotulado, puesta en marcha y limpieza, además de supuestos sobre permisos y exclusiones."],
      ],
      examplesTitle: "Ejemplos de partidas eléctricas",
      examplesIntro: "Úsalos para organizar el alcance, no como tarifas sugeridas. Ingresa tus propios precios y confirma que el trabajo cumpla los códigos y requisitos de licencia aplicables.",
      items: [
        ["Diagnóstico del servicio eléctrico", "visita u hora", "Describe el síntoma revisado y los límites del diagnóstico."],
        ["Instalación de tomacorriente, interruptor o luminaria", "cada uno", "Especifica el tipo de dispositivo, ubicación y acabado."],
        ["Circuito derivado nuevo", "circuito", "Indica la carga, la ruta prevista y la revisión de capacidad del panel."],
        ["Instalación de conducto o cable", "pie lineal o trabajo", "Anota la ruta, superficie y soportes o conexiones incluidos."],
        ["Trabajo en panel o interruptor", "cada uno o trabajo", "Enumera los componentes y la coordinación de cortes o inspecciones."],
        ["Pruebas, rotulado y limpieza", "trabajo", "Indica las verificaciones y pasos finales incluidos."],
      ],
      checklistTitle: "Confirma estos detalles antes de enviar",
      checklist: [
        "Confirma las ubicaciones, cantidades, requisitos de circuitos y equipos atendidos.",
        "Revisa acceso, estado del cableado, capacidad del panel, rutas y límites de reparación de acabados.",
        "Identifica permisos, inspecciones, cortes eléctricos y accesorios que aporta el cliente.",
        "Indica las pruebas, el rotulado, la limpieza y cómo manejarás trabajo oculto o exigido por código."],
      closeTitle: "Describe el trabajo con palabras claras para el cliente",
      close: "Una partida como “mano de obra eléctrica” puede causar dudas. Nombra el dispositivo o circuito, su ubicación y los acabados incluidos. Aclara las condiciones inciertas y pide aprobación antes de agregar trabajo. WorkCraft AI permite organizar partidas, reutilizar tu lista de precios y compartir un enlace de revisión.",
      faq: [
        ["¿Conviene separar materiales y mano de obra?", "Sepáralos cuando eso aclare el precio o las opciones; de lo contrario, describe lo incluido en la partida combinada."],
        ["¿Los ejemplos incluyen permisos?", "No. Los permisos e inspecciones dependen de la ubicación y el proyecto. Verifica los requisitos locales y agrega tus propios costos aplicables."],
      ],
      cta: "Crear una cotización eléctrica",
      related: "Usa la lista de verificación para cotizaciones eléctricas",
      crumbHome: "Inicio",
      crumbTrade: "Cotizaciones eléctricas",
      label: "Software de cotizaciones para electricistas",
      note: "Ejemplos de alcance · agrega tus propias tarifas",
    },
  },
  {
    key: "hvac",
    enPath: "estimates/hvac",
    esPath: "es/cotizaciones/climatizacion",
    guide: "price-a-small-trade-job",
    en: {
      trade: "HVAC",
      title: "HVAC Estimate Software for Equipment and Service Quotes | WorkCraft AI",
      description: "Prepare HVAC estimates on your phone. Organize equipment, ductwork, access, startup, and customer-approved options.",
      h1: "Make an HVAC estimate easier to review and approve.",
      intro: "A useful HVAC proposal identifies the equipment and work planned, records site constraints, and explains what commissioning or restoration is included. WorkCraft AI helps contractors prepare and share that estimate from the job site.",
      focusTitle: "Connect equipment, installation, and startup",
      focus: [
        ["Describe the system and basis", "Record existing equipment, served areas, customer concerns, and the sizing or design information still to be confirmed."],
        ["Separate replacement from related work", "List equipment, accessories, electrical or condensate changes, duct repairs, and removal when they are separate decisions."],
        ["Include startup and handoff", "State testing, controls setup, thermostat instructions, cleanup, and warranty documents included in the contractor’s scope."],
      ],
      examplesTitle: "HVAC line item examples",
      examplesIntro: "These are estimate structure ideas, not equipment recommendations or market prices. Confirm specifications and add your own rates before sending.",
      items: [
        ["System evaluation and load review", "visit or job", "State the measurements and design review included."],
        ["Heating or cooling equipment replacement", "system", "Identify equipment class and the specifications to be finalized."],
        ["Duct repair or modification", "linear ft. or job", "Describe the served area, material, and access assumptions."],
        ["Condensate, vent, or line-set work", "each or job", "Name the components and routing included."],
        ["Controls or thermostat installation", "each", "Describe setup, compatibility checks, and customer orientation."],
        ["Startup, testing, and old equipment removal", "system or job", "State commissioning checks and disposal assumptions."],
      ],
      checklistTitle: "Details to confirm before sending",
      checklist: [
        "Verify equipment specifications, electrical service, duct condition, clearances, and access.",
        "State what sizing, load, or site information still needs confirmation before equipment ordering.",
        "Clarify included accessories, permits, condensate or vent changes, disposal, and restoration work.",
        "Describe startup checks, customer handoff, schedule assumptions, and how changes are approved."],
      closeTitle: "Keep allowances and options transparent",
      close: "When equipment selection or site conditions are still being confirmed, label assumptions clearly. Show optional efficiency or control upgrades separately so the customer can compare them. WorkCraft AI helps HVAC contractors turn those choices into organized estimate items and a shareable proposal.",
      faq: [
        ["Should I put several system options in one line item?", "Separate equipment packages or upgrades when the customer needs to compare them; describe each option and its included scope."],
        ["Does WorkCraft AI calculate HVAC sizing or local pricing?", "No. The examples organize estimate scope. Qualified contractors must determine system design, code requirements, and their own prices."],
      ],
      cta: "Create an HVAC estimate",
      related: "Read the guide to pricing a small trade job",
      crumbHome: "Home",
      crumbTrade: "HVAC estimates",
      label: "Estimate software for HVAC contractors",
      note: "Scope examples only · add your own rates",
    },
    es: {
      trade: "Climatización (HVAC)",
      title: "Software para cotizaciones de HVAC y climatización | WorkCraft AI",
      description: "Prepara cotizaciones de HVAC desde el teléfono. Organiza equipos, ductos, acceso, puesta en marcha y opciones aprobadas.",
      h1: "Prepara una cotización de HVAC fácil de revisar y aprobar.",
      intro: "Una propuesta útil de climatización identifica el equipo y el trabajo previsto, registra las condiciones del sitio y explica las pruebas y restauraciones incluidas. WorkCraft AI ayuda a contratistas a preparar y compartir cotizaciones desde el lugar de trabajo.",
      focusTitle: "Relaciona el equipo, la instalación y la puesta en marcha",
      focus: [
        ["Describe el sistema y su base", "Registra el equipo existente, las áreas atendidas, las inquietudes del cliente y los datos de capacidad que faltan por confirmar."],
        ["Separa el reemplazo de otros trabajos", "Enumera equipos, accesorios, cambios eléctricos o de condensado, reparaciones de ductos y retiro cuando sean decisiones separadas."],
        ["Incluye pruebas y entrega", "Indica pruebas, configuración de controles, instrucciones del termostato, limpieza y documentos de garantía incluidos."],
      ],
      examplesTitle: "Ejemplos de partidas de HVAC",
      examplesIntro: "Son ideas para organizar el alcance, no recomendaciones de equipo ni precios de mercado. Confirma las especificaciones y agrega tus propias tarifas.",
      items: [
        ["Evaluación del sistema y revisión de carga", "visita o trabajo", "Indica las mediciones y revisión de diseño incluidas."],
        ["Reemplazo del equipo de calefacción o enfriamiento", "sistema", "Identifica el tipo de equipo y las especificaciones por confirmar."],
        ["Reparación o modificación de ductos", "pie lineal o trabajo", "Describe el área atendida, material y acceso previsto."],
        ["Trabajo en condensado, ventilación o líneas", "cada uno o trabajo", "Nombra los componentes y rutas incluidas."],
        ["Instalación de controles o termostato", "cada uno", "Describe la configuración, compatibilidad y explicación al cliente."],
        ["Puesta en marcha, pruebas y retiro del equipo anterior", "sistema o trabajo", "Indica las verificaciones y supuestos sobre disposición."],
      ],
      checklistTitle: "Confirma estos detalles antes de enviar",
      checklist: [
        "Verifica especificaciones, servicio eléctrico, estado de ductos, espacios libres y acceso.",
        "Indica qué datos de capacidad, carga o sitio deben confirmarse antes de ordenar el equipo.",
        "Aclara accesorios, permisos, cambios de condensado o ventilación, retiro y restauración incluidos.",
        "Describe pruebas, entrega al cliente, fechas previstas y cómo se aprobarán los cambios."],
      closeTitle: "Explica con claridad las provisiones y opciones",
      close: "Si aún se confirman la selección del equipo o las condiciones del sitio, identifica claramente los supuestos. Muestra por separado las mejoras de eficiencia o controles opcionales para que el cliente las compare. WorkCraft AI ayuda a organizar estas opciones como partidas y compartir la propuesta.",
      faq: [
        ["¿Debo combinar varias opciones de sistema en una partida?", "Sepáralas cuando el cliente deba compararlas; describe cada opción y el alcance incluido."],
        ["¿WorkCraft AI calcula la capacidad del sistema o precios locales?", "No. Los ejemplos organizan el alcance. Los contratistas calificados determinan el diseño, los requisitos de código y sus propios precios."],
      ],
      cta: "Crear una cotización de HVAC",
      related: "Lee la guía para calcular el precio de un trabajo pequeño",
      crumbHome: "Inicio",
      crumbTrade: "Cotizaciones de HVAC",
      label: "Software de cotizaciones para HVAC",
      note: "Ejemplos de alcance · agrega tus propias tarifas",
    },
  },
  {
    key: "handyman",
    enPath: "estimates/handyman",
    esPath: "es/cotizaciones/reparaciones-del-hogar",
    guide: "write-a-clear-contractor-estimate",
    en: {
      trade: "Handyman",
      title: "Handyman Estimate Software for Organized Job Quotes | WorkCraft AI",
      description: "Create handyman estimates on mobile. Group repairs by room, define included tasks, materials, access, and change approvals.",
      h1: "Give customers a handyman estimate with a clear task list.",
      intro: "Small repair visits can involve several unrelated tasks. Group work by room or trade, list what is included, and separate unknown repairs so the customer understands the visit. WorkCraft AI helps independent handymen build and share that estimate from a phone.",
      focusTitle: "Group small tasks into a readable scope",
      focus: [
        ["Organize by room or work area", "Use separate groups for different rooms, doors, fixtures, trim, or patching so tasks are easy to confirm."],
        ["Clarify labor and supplies", "State whether hardware, consumables, finish materials, disposal, and travel are included or billed separately."],
        ["Set boundaries for repairs", "Describe surface preparation and finish limits, note pre-existing damage, and explain how extra work gets approved."],
      ],
      examplesTitle: "Handyman line item examples",
      examplesIntro: "These are organizing prompts, not local prices. Set your own rates and check whether local rules require a permit or licensed trade professional.",
      items: [
        ["Service visit and setup", "visit or job", "State the included arrival, protection, and setup."],
        ["Door, cabinet, or hardware adjustment", "each", "Name the item and the adjustment or replacement included."],
        ["Fixture or accessory installation", "each", "Specify the item, mounting surface, and customer-supplied parts."],
        ["Drywall patch and surface preparation", "patch or sq. ft.", "Describe size, texture match, and whether paint is included."],
        ["Trim or caulk repair", "linear ft. or area", "List the section and finish expectations."],
        ["Cleanup and disposal", "job", "Clarify what debris is removed and any excluded disposal fees."],
      ],
      checklistTitle: "Details to confirm before sending",
      checklist: [
        "List each task and location; identify which rooms or items are excluded.",
        "Confirm customer-supplied materials, hardware, finish matching, and access to the work area.",
        "State minimum visit charges, included time, disposal, and return-visit assumptions if applicable.",
        "Identify hidden damage, permit needs, and work that must be referred to a licensed specialist."],
      closeTitle: "Prevent a small repair list from becoming a surprise",
      close: "A concise task list can prevent disagreements about what a visit covers. Describe each repair, location, finish level, and material assumption. If the customer adds tasks or hidden damage appears, pause and agree on the revised scope first. WorkCraft AI makes it easier to reuse common items and send the estimate link for review.",
      faq: [
        ["Should I estimate a group of small repairs as one job?", "You can group them under one proposal, while keeping separate line items for tasks the customer may want to approve or decline individually."],
        ["Can a handyman quote licensed electrical, plumbing, or HVAC work?", "Follow your local licensing and permit rules. Refer regulated work to a qualified licensed professional where required."],
      ],
      cta: "Create a handyman estimate",
      related: "Learn how to write a clear contractor estimate",
      crumbHome: "Home",
      crumbTrade: "Handyman estimates",
      label: "Estimate software for handymen",
      note: "Scope examples only · add your own rates",
    },
    es: {
      trade: "Reparaciones del hogar",
      title: "Software para cotizaciones de reparaciones del hogar | WorkCraft AI",
      description: "Crea cotizaciones de reparaciones desde el móvil. Agrupa tareas por habitación y aclara materiales, acceso y cambios.",
      h1: "Entrega una cotización con una lista clara de reparaciones.",
      intro: "Una visita de reparaciones puede incluir varias tareas distintas. Agrúpalas por habitación u oficio, enumera lo incluido y separa las reparaciones inciertas para que el cliente entienda el trabajo. WorkCraft AI ayuda a contratistas independientes a preparar y compartir cotizaciones desde el teléfono.",
      focusTitle: "Agrupa las tareas pequeñas en un alcance fácil de leer",
      focus: [
        ["Organiza por habitación o zona", "Separa las tareas de distintas habitaciones, puertas, accesorios, molduras o parches para que sea fácil confirmarlas."],
        ["Aclara mano de obra y materiales", "Indica si herrajes, consumibles, materiales de acabado, disposición de residuos y traslado están incluidos o se cobran aparte."],
        ["Define los límites de la reparación", "Describe la preparación y el acabado, anota daños existentes y explica cómo se aprobará el trabajo adicional."],
      ],
      examplesTitle: "Ejemplos de partidas para reparaciones del hogar",
      examplesIntro: "Son ideas para organizar el alcance, no precios locales. Define tus tarifas y confirma si las reglas locales exigen permisos o profesionales con licencia.",
      items: [
        ["Visita de servicio y preparación", "visita o trabajo", "Indica la llegada, protección y preparación incluidas."],
        ["Ajuste de puerta, gabinete o herraje", "cada uno", "Nombra el artículo y el ajuste o reemplazo incluido."],
        ["Instalación de accesorio", "cada uno", "Especifica el artículo, superficie de montaje y piezas que aporta el cliente."],
        ["Parche de panel de yeso y preparación", "parche o pie²", "Describe el tamaño, la textura y si incluye pintura."],
        ["Reparación de moldura o sellador", "pie lineal o zona", "Indica la sección y el acabado esperado."],
        ["Limpieza y disposición de residuos", "trabajo", "Aclara qué residuos retiras y si hay cargos de disposición excluidos."],
      ],
      checklistTitle: "Confirma estos detalles antes de enviar",
      checklist: [
        "Enumera cada tarea y ubicación; indica las habitaciones o artículos excluidos.",
        "Confirma materiales y herrajes del cliente, combinación de acabados y acceso al área.",
        "Indica cargos mínimos, tiempo incluido, disposición y supuestos sobre visitas adicionales.",
        "Identifica daños ocultos, permisos y trabajo que debe realizar un especialista con licencia."],
      closeTitle: "Evita que una lista de reparaciones pequeñas cause sorpresas",
      close: "Una lista breve de tareas puede evitar desacuerdos sobre lo que cubre la visita. Describe cada reparación, ubicación, acabado y material previsto. Si el cliente agrega tareas o aparece daño oculto, acuerden primero el alcance actualizado. WorkCraft AI facilita reutilizar partidas frecuentes y compartir el enlace para revisión.",
      faq: [
        ["¿Puedo cotizar varias reparaciones pequeñas como un solo trabajo?", "Sí. Puedes agruparlas en una propuesta y mantener partidas separadas para que el cliente pueda aprobar o rechazar tareas individuales."],
        ["¿Un contratista de reparaciones puede cotizar trabajos eléctricos, de plomería o HVAC regulados?", "Sigue las reglas locales de licencias y permisos. Cuando sea necesario, deriva el trabajo regulado a un profesional calificado con licencia."],
      ],
      cta: "Crear una cotización de reparaciones",
      related: "Aprende a redactar una cotización clara para contratistas",
      crumbHome: "Inicio",
      crumbTrade: "Cotizaciones de reparaciones",
      label: "Software de cotizaciones para reparaciones del hogar",
      note: "Ejemplos de alcance · agrega tus propias tarifas",
    },
  },
];

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function arrow() {
  return '<svg class="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>';
}

function list(items, className) {
  return `<ul class="${className}">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function siteHeader(copy, languagePath, spanish) {
  const home = spanish ? "/es/" : "/";
  const resource = spanish ? "/es/resources/" : "/resources/";
  const langLabel = spanish ? "Cambiar a inglés" : "Switch to Spanish";
  const menuLabel = spanish ? "Abrir menú de navegación" : "Open navigation menu";
  const signIn = spanish ? "Iniciar sesión" : "Sign in";
  const start = spanish ? "Empieza gratis" : "Start free";
  const nav = spanish
    ? [["Cómo funciona", `${home}#how-it-works`], ["Planes", `${home}#plans`], ["Recursos", resource], ["Acerca de", `${home}#about`]]
    : [["How it works", `${home}#how-it-works`], ["Plans", `${home}#plans`], ["Resources", resource], ["About", `${home}#about`]];
  return `<header class="site-header">
      <a class="brand" href="${home}" aria-label="${spanish ? "Inicio de WorkCraft AI" : "WorkCraft AI home"}"><img class="brand-image" src="/assets/workcraft-ai-logo.svg" alt="WorkCraft AI" /></a>
      <nav class="main-nav" aria-label="${spanish ? "Navegación principal" : "Main navigation"}">${nav.map(([label, href]) => `<a href="${href}">${label}</a>`).join("")}</nav>
      <button class="language-toggle" id="language-toggle" type="button" aria-label="${langLabel}" data-language-href="/${languagePath}/">${spanish ? "EN" : "ES"}</button>
      <button class="menu-toggle" type="button" aria-controls="mobile-navigation" aria-expanded="false" aria-label="${menuLabel}">${spanish ? "Menú" : "Menu"}</button>
      <nav class="mobile-nav" id="mobile-navigation" aria-label="${spanish ? "Navegación móvil" : "Mobile navigation"}" hidden>${nav.map(([label, href]) => `<a href="${href}">${label}</a>`).join("")}<a href="https://app.workcraftai.com/login">${signIn}</a></nav>
      <div class="header-actions"><a class="header-signin" href="https://app.workcraftai.com/login">${signIn}</a><a class="button button-small header-cta" href="${appUrl}">${start} ${arrow()}</a></div>
    </header>`;
}

function renderPage(trade, locale) {
  const spanish = locale === "es";
  const copy = trade[locale];
  const pathName = spanish ? trade.esPath : trade.enPath;
  const canonical = `${origin}/${pathName}/`;
  const enUrl = `${origin}/${trade.enPath}/`;
  const esUrl = `${origin}/${trade.esPath}/`;
  const homeUrl = `${origin}${spanish ? "/es/" : "/"}`;
  const otherPath = spanish ? trade.enPath : trade.esPath;
  const guide = `${origin}${spanish ? "/es/resources/" : "/resources/"}${trade.guide}/`;
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${canonical}#webpage`,
        url: canonical,
        name: copy.title,
        description: copy.description,
        inLanguage: spanish ? "es-US" : "en-US",
        isPartOf: { "@id": `${origin}/#website` },
        about: { "@id": `${origin}/#software` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: copy.crumbHome, item: homeUrl },
          { "@type": "ListItem", position: 2, name: copy.crumbTrade, item: canonical },
        ],
      },
    ],
  };
  const focusCards = copy.focus.map(([title, body], index) => `<article class="trade-focus-card"><span class="trade-card-number">0${index + 1}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></article>`).join("");
  const exampleCards = copy.items.map(([title, unit, body]) => `<article class="trade-line-card"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p><span>${spanish ? "Unidad de ejemplo" : "Example unit"}: <strong>${escapeHtml(unit)}</strong></span></article>`).join("");
  const faqItems = copy.faq.map(([question, answer]) => `<details class="trade-faq-item"><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`).join("");
  return `<!doctype html>
<html lang="${spanish ? "es" : "en"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#f5f3ec" />
    <meta name="description" content="${escapeHtml(copy.description)}" />
    <title>${escapeHtml(copy.title)}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/styles.css" />
    <link rel="stylesheet" href="/trade-pages.css" />
    <link rel="canonical" href="${canonical}" />
    <link rel="alternate" hreflang="en-US" href="${enUrl}" />
    <link rel="alternate" hreflang="es-US" href="${esUrl}" />
    <link rel="alternate" hreflang="x-default" href="${enUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="WorkCraft AI" />
    <meta property="og:title" content="${escapeHtml(copy.title)}" />
    <meta property="og:description" content="${escapeHtml(copy.description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${origin}/assets/workcraftai-og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="WorkCraft AI estimate and job workspace for ${escapeHtml(copy.trade)} contractors" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(copy.title)}" />
    <meta name="twitter:description" content="${escapeHtml(copy.description)}" />
    <meta name="twitter:image" content="${origin}/assets/workcraftai-og.png" />
    <script type="application/ld+json">${JSON.stringify(schema).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <a class="skip-link" href="#main">${spanish ? "Saltar al contenido" : "Skip to content"}</a>
    ${siteHeader(copy, otherPath, spanish)}
    <main id="main" class="trade-main">
      <nav class="trade-breadcrumbs" aria-label="${spanish ? "Ruta de navegación" : "Breadcrumb"}"><a href="${homeUrl}">${escapeHtml(copy.crumbHome)}</a><span aria-hidden="true">/</span><span aria-current="page">${escapeHtml(copy.crumbTrade)}</span></nav>
      <section class="trade-hero section-wrap">
        <div class="trade-hero-copy"><p class="eyebrow"><span class="eyebrow-line"></span>${escapeHtml(copy.label)}</p><h1>${escapeHtml(copy.h1)}</h1><p class="trade-intro">${escapeHtml(copy.intro)}</p><div class="trade-hero-actions"><a class="button button-dark" href="${appUrl}">${escapeHtml(copy.cta)} ${arrow()}</a><a class="text-link" href="${guide}">${escapeHtml(copy.related)} ${arrow()}</a></div><p class="trade-no-card">${spanish ? "Empieza gratis · No se requiere tarjeta de crédito" : "Start free · No credit card required"}</p></div>
        <aside class="trade-scope-card" aria-label="${escapeHtml(copy.note)}"><span class="trade-scope-mark" aria-hidden="true">${spanish ? "OFICIO" : "FIELD"}</span><h2>${escapeHtml(copy.examplesTitle)}</h2><p>${escapeHtml(copy.note)}</p><ul>${copy.items.slice(0, 3).map(([title, unit]) => `<li><span>${escapeHtml(title)}</span><strong>${escapeHtml(unit)}</strong></li>`).join("")}</ul><small>${spanish ? "WorkCraft AI no proporciona tarifas locales ni cotizaciones de proveedores." : "WorkCraft AI does not provide local market rates or supplier quotes."}</small></aside>
      </section>
      <section class="trade-focus-section section-wrap" aria-labelledby="trade-focus-title"><div class="trade-section-heading"><p class="eyebrow"><span class="eyebrow-line"></span>${spanish ? "Un alcance que se entiende" : "A scope customers can understand"}</p><h2 id="trade-focus-title">${escapeHtml(copy.focusTitle)}</h2></div><div class="trade-focus-grid">${focusCards}</div></section>
      <section class="trade-examples-section" aria-labelledby="trade-examples-title"><div class="section-wrap"><div class="trade-section-heading"><p class="eyebrow"><span class="eyebrow-line"></span>${spanish ? "Ejemplos para personalizar" : "Examples to customize"}</p><h2 id="trade-examples-title">${escapeHtml(copy.examplesTitle)}</h2><p>${escapeHtml(copy.examplesIntro)}</p></div><div class="trade-line-grid">${exampleCards}</div></div></section>
      <section class="trade-checklist-section section-wrap" aria-labelledby="trade-checklist-title"><div class="trade-checklist-copy"><p class="eyebrow"><span class="eyebrow-line"></span>${spanish ? "Antes de compartir" : "Before you share"}</p><h2 id="trade-checklist-title">${escapeHtml(copy.checklistTitle)}</h2><p>${escapeHtml(copy.close)}</p><a class="text-link" href="${guide}">${escapeHtml(copy.related)} ${arrow()}</a></div><div class="trade-checklist-card">${list(copy.checklist, "trade-checklist")}</div></section>
      <section class="trade-faq-section section-wrap" aria-labelledby="trade-faq-title"><div class="trade-section-heading"><p class="eyebrow"><span class="eyebrow-line"></span>${spanish ? "Preguntas frecuentes" : "Common questions"}</p><h2 id="trade-faq-title">${escapeHtml(copy.closeTitle)}</h2></div><div class="trade-faq-list">${faqItems}</div></section>
      <section class="trade-cta-band"><div class="section-wrap trade-cta-inner"><div><p class="eyebrow eyebrow-light">${spanish ? "Cotizaciones desde el sitio de trabajo" : "Estimates from the job site"}</p><h2>${spanish ? `Prepara tu próxima cotización de ${escapeHtml(copy.trade.toLowerCase())} con WorkCraft AI.` : `Build your next ${escapeHtml(copy.trade.toLowerCase())} estimate with WorkCraft AI.`}</h2><p>${spanish ? "Crea una cuenta gratis, agrega tus propios precios y comparte un enlace para que el cliente revise tu propuesta." : "Create a free account, add your own prices, and share a link for the customer to review your proposal."}</p></div><a class="button button-light" href="${appUrl}">${escapeHtml(copy.cta)} ${arrow()}</a></div></section>
    </main>
    <footer class="site-footer"><div class="footer-main section-wrap"><a class="brand brand-footer" href="${homeUrl}"><img class="brand-image" src="/assets/workcraft-ai-logo.svg" alt="WorkCraft AI" /></a><p>${spanish ? "Para quienes hacen el trabajo." : "For the people who get the work done."}<br />${spanish ? "Mantén el buen trabajo en marcha." : "Keep good work moving."}</p><a class="footer-app-link" href="${appUrl}">${spanish ? "Empieza gratis" : "Start free"} ${arrow()}</a></div><div class="footer-badge-row section-wrap"><a href="https://saasbrowser.com/en/saas/1708905/workcraft-ai" target="_blank" rel="nofollow noopener"><img src="https://files.saasbrowser.com/2rclabjaa51twu7b2vhrhzgmbq19" alt="WorkCraft AI - SaaS directory verified badge" width="200" height="133" loading="lazy" referrerpolicy="no-referrer" /></a></div><div class="footer-bottom section-wrap"><span>© <span id="year">2026</span> WorkCraft AI. ${spanish ? "Todos los derechos reservados." : "All rights reserved."}</span><nav class="footer-links" aria-label="${spanish ? "Información legal y soporte" : "Legal and support"}"><a href="${spanish ? "/es/resources/" : "/resources/"}">${spanish ? "Recursos" : "Resources"}</a><a href="https://app.workcraftai.com/privacy">${spanish ? "Privacidad" : "Privacy"}</a><a href="https://app.workcraftai.com/terms">${spanish ? "Términos" : "Terms"}</a><a href="https://app.workcraftai.com/support">${spanish ? "Soporte" : "Support"}</a></nav><span>${spanish ? "Hecho para el trabajo que mantiene todo en marcha." : "Built for the work that keeps things moving."}</span></div></footer>
    <script src="/assets/site.js" defer></script>
  </body>
</html>
`;
}

function sitemapEntry(trade) {
  const enUrl = `${origin}/${trade.enPath}/`;
  const esUrl = `${origin}/${trade.esPath}/`;
  return [enUrl, esUrl].map((url) => {
    const languageLinks = `    <xhtml:link rel="alternate" hreflang="en-US" href="${enUrl}" />\n    <xhtml:link rel="alternate" hreflang="es-US" href="${esUrl}" />\n    <xhtml:link rel="alternate" hreflang="x-default" href="${enUrl}" />`;
    return `  <url>\n    <loc>${url}</loc>\n    <lastmod>${lastmod}</lastmod>\n${languageLinks}\n  </url>`;
  }).join("\n");
}

for (const trade of trades) {
  for (const locale of ["en", "es"]) {
    const relativePath = locale === "es" ? trade.esPath : trade.enPath;
    const destination = path.join(siteRoot, relativePath, "index.html");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, renderPage(trade, locale));
  }
}

const sitemapPath = path.join(siteRoot, "sitemap.xml");
let sitemap = await readFile(sitemapPath, "utf8");
const generatedPaths = new Set(trades.flatMap((trade) => [`${origin}/${trade.enPath}/`, `${origin}/${trade.esPath}/`]));
sitemap = sitemap.replace(/\s*<url>[\s\S]*?<\/url>/g, (block) => {
  const loc = block.match(/<loc>(.*?)<\/loc>/)?.[1];
  return loc && generatedPaths.has(loc) ? "" : block;
});
sitemap = sitemap.replace("</urlset>", `${sitemapEntry(trades[0])}\n${trades.slice(1).map(sitemapEntry).join("\n")}\n</urlset>`);
await writeFile(sitemapPath, sitemap);
console.log(`Generated ${trades.length * 2} trade pages and updated sitemap.xml.`);
