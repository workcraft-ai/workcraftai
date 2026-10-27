export type HelpGuide = {
  slug: string;
  title: { en: string; es: string };
  summary: { en: string; es: string };
  steps: { en: string[]; es: string[] };
  note: { en: string; es: string };
  action: { href: string; en: string; es: string };
};

export const helpGuides: HelpGuide[] = [
  {
    slug: "install-on-phone", title: { en: "Add WorkCraft AI to your phone", es: "Agrega WorkCraft AI a tu teléfono" },
    summary: { en: "Put the WorkCraft AI icon on your Home Screen for quick access.", es: "Coloca el ícono de WorkCraft AI en la pantalla de inicio para entrar rápidamente." },
    steps: {
      en: ["On iPhone, open app.workcraftai.com in Safari and sign in.", "Tap Share, then Add to Home Screen. If shown, turn on Open as Web App, then tap Add.", "On Android, open app.workcraftai.com in Chrome and sign in.", "Open Chrome's menu and choose Install app or Add to Home screen, then confirm.", "Open the WorkCraft AI icon from your Home Screen. Sign in again if your browser asks you to."],
      es: ["En iPhone, abre app.workcraftai.com en Safari e inicia sesión.", "Toca Compartir y luego Agregar a pantalla de inicio. Si aparece la opción, activa Abrir como app y toca Agregar.", "En Android, abre app.workcraftai.com en Chrome e inicia sesión.", "Abre el menú de Chrome y elige Instalar app o Agregar a pantalla principal; después confirma.", "Abre el ícono de WorkCraft AI desde la pantalla de inicio. Vuelve a iniciar sesión si el navegador te lo pide."],
    },
    note: { en: "This adds the web app to your phone; it does not download an App Store or Play Store app. WorkCraft AI still needs an internet connection for estimates, customer records, and payments.", es: "Esto agrega la aplicación web a tu teléfono; no descarga una app de App Store ni Play Store. WorkCraft AI aún necesita internet para cotizaciones, datos de clientes y pagos." },
    action: { href: "/dashboard", en: "Open Dashboard", es: "Abrir Panel" },
  },
  {
    slug: "start-pro-trial", title: { en: "Start your 14-day Pro trial", es: "Inicia tu prueba de Pro de 14 días" },
    summary: { en: "Find your trial offer, understand eligibility, and know what happens when it ends.", es: "Encuentra la oferta de prueba, consulta los requisitos y conoce qué pasa cuando termina." },
    steps: {
      en: ["Sign in to your confirmed WorkCraft AI account. Eligible accounts can start one trial.", "Open Profile → Your plan, or choose the trial offer shown on Dashboard, Customers, Price Book, or when opening a Pro feature.", "Start the 14-day Pro trial. No payment method is needed to begin.", "During the trial, the offer changes to Upgrade to Pro. To continue after the trial, add billing details in Manage billing before it ends; Pro is $9.99/month.", "If you do not add billing, the trial ends automatically and your account returns to Free. Your saved estimates, customers, jobs, and other account data remain available."],
      es: ["Inicia sesión en tu cuenta confirmada de WorkCraft AI. Las cuentas aptas pueden iniciar una sola prueba.", "Abre Perfil → Tu plan o elige la oferta de prueba que aparece en el Panel, Clientes, Lista de precios o al abrir una función Pro.", "Inicia la prueba de Pro de 14 días. No necesitas un método de pago para comenzar.", "Durante la prueba, la oferta cambia a Mejorar a Pro. Para continuar después, agrega los datos de facturación en Administrar facturación antes de que termine; Pro cuesta $9.99 al mes.", "Si no agregas datos de facturación, la prueba termina automáticamente y tu cuenta vuelve al plan Gratis. Tus cotizaciones, clientes, trabajos y otros datos guardados permanecen disponibles."],
    },
    note: { en: "The trial is available only to eligible accounts. Accounts that have used a trial or have prior Stripe subscription history may see the paid upgrade price instead.", es: "La prueba solo está disponible para cuentas aptas. Las cuentas que ya usaron una prueba o tienen un historial previo de suscripción en Stripe podrían ver directamente el precio de pago." },
    action: { href: "/profile#plan", en: "View my plan", es: "Ver mi plan" },
  },
  {
    slug: "pro-payment-recovery", title: { en: "Fix a failed Pro subscription payment", es: "Soluciona un pago fallido de Pro" },
    summary: { en: "Update your card and understand when Pro access changes.", es: "Actualiza tu tarjeta y consulta cuándo cambia tu acceso Pro." },
    steps: {
      en: ["Open Profile → Your plan and read the billing notice and grace deadline.", "Choose Manage billing to open Stripe's secure billing page.", "Update your payment method or pay the open invoice there. Check any Stripe email about the failed payment or expiring card.", "Return to WorkCraft AI and refresh your plan after Stripe confirms the payment."],
      es: ["Abre Perfil → Tu plan y lee el aviso de facturación y la fecha límite.", "Elige Administrar facturación para abrir la página segura de Stripe.", "Actualiza el método de pago o paga la factura pendiente allí. Revisa los correos de Stripe sobre pagos fallidos o tarjetas por vencer.", "Regresa a WorkCraft AI y actualiza la página de tu plan cuando Stripe confirme el pago."],
    },
    note: { en: "A failed renewal keeps Pro available for three weekdays from the first recorded failure. Stripe may retry for longer. If the grace period ends first, Free features and saved data remain available.", es: "Después de un cobro fallido, Pro sigue disponible durante tres días de lunes a viernes desde el primer fallo registrado. Stripe puede seguir intentando cobrar después. Si vence ese plazo, permanecen disponibles las funciones gratuitas y tus datos guardados." },
    action: { href: "/profile#plan", en: "Manage my plan", es: "Administrar mi plan" },
  },
  {
    slug: "first-estimate", title: { en: "Create your first estimate", es: "Crea tu primera cotización" },
    summary: { en: "Start with one customer, one job, and prices you control.", es: "Comienza con un cliente, un trabajo y los precios que tú eliges." },
    steps: { en: ["Open New estimate from the Dashboard.", "Enter the customer and job location.", "Add a line item with its quantity, unit, and price.", "Review the total and save. Open the customer view before sharing."], es: ["Abre Nueva cotización desde el Panel.", "Ingresa el cliente y la ubicación del trabajo.", "Agrega un concepto con cantidad, unidad y precio.", "Revisa el total y guarda. Abre la vista del cliente antes de compartir."] },
    note: { en: "Price Book, AI, photos, and packages can wait until after your first estimate.", es: "Puedes configurar la lista de precios, IA, fotos y paquetes después de tu primera cotización." },
    action: { href: "/estimate/new", en: "New estimate", es: "Nueva cotización" },
  },
  {
    slug: "subscribe-job-calendar", title: { en: "See your jobs in your phone calendar", es: "Ve tus trabajos en el calendario de tu teléfono" },
    summary: { en: "Subscribe to a private, read-only job calendar in Apple Calendar, Google Calendar, or another calendar app.", es: "Suscríbete a un calendario privado de trabajos, de solo lectura, en Apple Calendar, Google Calendar u otra aplicación compatible." },
    steps: {
      en: ["With Pro, open Schedule & Job Tracking and set a date, time, and estimated duration on each job. WorkCraft AI saves the time zone used when you schedule it.", "In Calendar sync, create your private subscription link. Choose whether to include jobs from estimates, directly entered jobs, and completed jobs. Turn on Show customer name only if you want names in calendar titles, then save options.", "For Apple Calendar, choose Add Subscription Calendar and paste the link. For Google Calendar, use Other calendars → + → From URL on a computer and paste the link.", "Change dates and durations in WorkCraft AI. Your calendar app refreshes the subscription on its own schedule; Google updates may take several hours."],
      es: ["Con Pro, abre Agenda y trabajos e indica fecha, hora y duración estimada de cada trabajo. WorkCraft AI guarda la zona horaria usada al programarlo.", "En Sincronizar calendario, crea tu enlace privado. Elige si quieres incluir trabajos de cotizaciones, trabajos ingresados directamente y trabajos completados. Activa Mostrar nombre del cliente solo si quieres nombres en los títulos y guarda las opciones.", "En Apple Calendar, elige Agregar calendario de suscripción y pega el enlace. En Google Calendar, usa Otros calendarios → + → Desde URL en una computadora y pega el enlace.", "Cambia las fechas y duraciones en WorkCraft AI. Tu aplicación de calendario actualiza la suscripción según su propio horario; Google puede tardar varias horas."],
    },
    note: { en: "The link is a private access key: anyone holding it can see selected job times and addresses. Customer emails and private notes are never included. Replacing or disabling the link stops new updates; remove the old subscription from your calendar app too. Changes made in the calendar app do not update WorkCraft AI.", es: "El enlace es una clave de acceso privada: quien lo tenga puede ver horarios y direcciones de los trabajos seleccionados. Nunca se incluyen correos del cliente ni notas privadas. Reemplazar o desactivar el enlace detiene las actualizaciones; elimina también la suscripción anterior de tu calendario. Los cambios hechos allí no actualizan WorkCraft AI." },
    action: { href: "/schedule", en: "Open Schedule & Jobs", es: "Abrir Agenda y trabajos" },
  },
  {
    slug: "business-logo", title: { en: "Add your business name and logo", es: "Agrega el nombre y logotipo de tu negocio" },
    summary: { en: "Your saved business details appear on customer-facing estimates.", es: "Los datos guardados de tu negocio aparecen en las cotizaciones para clientes." },
    steps: { en: ["Open Profile and enter your business name and contact details.", "If you have a publicly accessible logo image, paste its HTTPS URL into Public logo URL.", "Choose a brand color and save preferences.", "Preview an estimate to check how the branding looks."], es: ["Abre Perfil e ingresa el nombre y los datos de contacto del negocio.", "Si tienes una imagen pública del logotipo, pega su URL HTTPS en URL pública del logotipo.", "Elige un color de marca y guarda las preferencias.", "Revisa una cotización para ver cómo aparece la marca."] },
    note: { en: "Logo file upload is not available yet. The logo field accepts a public image URL and is optional.", es: "Aún no puedes subir un archivo de logotipo. El campo acepta una URL pública de imagen y es opcional." },
    action: { href: "/profile", en: "Open Profile", es: "Abrir Perfil" },
  },
  {
    slug: "price-book", title: { en: "Save a reusable price", es: "Guarda un precio reutilizable" },
    summary: { en: "Reuse rates for work you quote often.", es: "Reutiliza los precios de los trabajos que cotizas con frecuencia." },
    steps: { en: ["Open Price book and add a service or material.", "Enter its unit and your rate, then save.", "On a new estimate, choose Add from price book.", "Review the rate for this particular job before sharing."], es: ["Abre Lista de precios y agrega un servicio o material.", "Ingresa la unidad y tu precio; después guarda.", "En una nueva cotización, elige Agregar de la lista de precios.", "Revisa el precio para ese trabajo antes de compartir."] },
    note: { en: "You can create your first estimate without setting up a Price Book.", es: "Puedes crear tu primera cotización sin configurar la lista de precios." },
    action: { href: "/pricebook", en: "Open Price Book", es: "Abrir Lista de precios" },
  },
  {
    slug: "ai-pricing", title: { en: "Review AI draft prices", es: "Revisa los precios del borrador con IA" },
    summary: { en: "AI helps draft scope; you make the final pricing decision.", es: "La IA ayuda a redactar el alcance; tú decides el precio final." },
    steps: { en: ["Describe the job and measurements in the Pro AI assistant.", "Clear matches use your saved Price Book rate. For possible matches, choose a saved item or explicitly use the AI starting price.", "Check every suggested unit, quantity, labor and material assumption.", "Edit the rates and confirm the final total before sharing."], es: ["Describe el trabajo y las medidas en el asistente de IA Pro.", "Las coincidencias claras usan el precio guardado en tu lista. Para las coincidencias posibles, elige un artículo guardado o usa explícitamente el precio inicial de IA.", "Revisa cada unidad, cantidad y supuesto de mano de obra y materiales.", "Edita los precios y confirma el total antes de compartir."] },
    note: { en: "AI prices are starting estimates, not live supplier quotes. If you select the same Price Book item for an AI description twice, WorkCraft AI learns that name only for your account. You can remove learned names in Price Book.", es: "Los precios de IA son estimaciones iniciales, no cotizaciones actuales de proveedores. Si eliges dos veces el mismo artículo de la lista para una descripción de IA, WorkCraft AI aprende ese nombre solo para tu cuenta. Puedes eliminar los nombres aprendidos en la lista de precios." },
    action: { href: "/estimate/new", en: "Start an estimate", es: "Iniciar una cotización" },
  },
  {
    slug: "share-estimate", title: { en: "Share an estimate with a customer", es: "Comparte una cotización con un cliente" },
    summary: { en: "A saved estimate has a customer link; saving alone does not send it.", es: "Una cotización guardada tiene un enlace para el cliente; guardarla no lo envía." },
    steps: { en: ["Save the estimate and open it from Dashboard.", "Review the customer proposal and copy its customer link.", "Send that link from your own text or email app, or use Email client if your current plan includes it.", "Check the customer email address before sending."], es: ["Guarda la cotización y ábrela desde el Panel.", "Revisa la propuesta y copia el enlace para el cliente.", "Envía el enlace desde tu aplicación de mensajes o correo, o usa Enviar correo al cliente si tu plan actual lo incluye.", "Comprueba la dirección del cliente antes de enviarlo."] },
    note: { en: "Copying a link does not send an email or prove the customer opened it.", es: "Copiar un enlace no envía un correo ni demuestra que el cliente lo abrió." },
    action: { href: "/dashboard", en: "Open Dashboard", es: "Abrir Panel" },
  },
  {
    slug: "customer-replies", title: { en: "Find a customer's response or question", es: "Encuentra la respuesta o pregunta de un cliente" },
    summary: { en: "Customers can respond from their proposal link without an account.", es: "Los clientes pueden responder desde la propuesta sin crear una cuenta." },
    steps: { en: ["Open the notification bell or Customer questions on Dashboard.", "Read the customer's question and estimate reference.", "Use the displayed email address to reply to the customer.", "Open the estimate to review its current status, then mark the question read."], es: ["Abre la campana de avisos o Preguntas de clientes en el Panel.", "Lee la pregunta y la referencia de la cotización.", "Usa la dirección mostrada para responder al cliente.", "Abre la cotización para revisar su estado y marca la pregunta como leída."] },
    note: { en: "Free accounts see questions in the app; Pro also includes email alerts within its email allowance.", es: "Las cuentas gratuitas ven las preguntas en la aplicación; Pro también incluye alertas por correo dentro de su límite." },
    action: { href: "/dashboard", en: "Open Dashboard", es: "Abrir Panel" },
  },
  {
    slug: "invoice", title: { en: "Create an invoice from accepted work", es: "Crea una factura de un trabajo aceptado" },
    summary: { en: "Pro turns an accepted estimate into a job and printable invoice.", es: "Pro convierte una cotización aceptada en un trabajo y una factura imprimible." },
    steps: { en: ["Open the accepted estimate from Dashboard.", "Choose Create invoice or View invoice.", "Review the job, totals, and invoice before emailing it.", "Keep the accepted proposal link available for customer payment."], es: ["Abre la cotización aceptada desde el Panel.", "Elige Crear factura o Ver factura.", "Revisa el trabajo, los totales y la factura antes de enviarla.", "Conserva el enlace de la propuesta aceptada para el pago del cliente."] },
    note: { en: "Customer checkout uses the accepted proposal balance, not a separate amount edited only on the invoice.", es: "El pago del cliente usa el saldo de la propuesta aceptada, no un importe editado solamente en la factura." },
    action: { href: "/dashboard", en: "Find an accepted estimate", es: "Buscar una cotización aceptada" },
  },
  {
    slug: "connect-stripe", title: { en: "Connect Stripe and your payout account", es: "Conecta Stripe y tu cuenta para depósitos" },
    summary: { en: "Stripe collects verification and bank details on its own secure screens.", es: "Stripe recopila los datos de verificación y banco en sus propias pantallas seguras." },
    steps: { en: ["With Pro, open Profile and choose Connect Stripe.", "Complete Stripe's business, identity, and payout steps.", "Return to Profile and follow any Continue Stripe setup prompt.", "Wait for Connected and can accept payments before offering online checkout."], es: ["Con Pro, abre Perfil y elige Conectar Stripe.", "Completa los pasos de negocio, identidad y depósitos de Stripe.", "Regresa al Perfil y sigue cualquier aviso para continuar la configuración.", "Espera a ver Conectado y puede aceptar pagos antes de ofrecer pagos en línea."] },
    note: { en: "Never send bank numbers, identity documents, or card details to WorkCraft AI support.", es: "Nunca envíes números bancarios, documentos de identidad ni datos de tarjetas al soporte de WorkCraft AI." },
    action: { href: "/profile", en: "Open Stripe setup", es: "Abrir configuración de Stripe" },
  },
  {
    slug: "customer-payments", title: { en: "Understand customer payments and payouts", es: "Entiende los pagos y depósitos" },
    summary: { en: "Customers pay on Stripe after approving the proposal.", es: "Los clientes pagan en Stripe después de aprobar la propuesta." },
    steps: { en: ["Share the accepted proposal link with the customer.", "The customer chooses an available down payment or balance payment and completes Stripe Checkout.", "Check the payment record in WorkCraft AI and in your Stripe Dashboard.", "Review payout timing and account details in Stripe."], es: ["Comparte con el cliente el enlace de la propuesta aceptada.", "El cliente elige el anticipo o saldo disponible y completa el pago en Stripe.", "Revisa el pago en WorkCraft AI y en tu panel de Stripe.", "Consulta el calendario de depósitos y los datos de tu cuenta en Stripe."] },
    note: { en: "If a customer was charged but the app says unpaid, do not ask them to pay again; contact support with the estimate reference, amount, and time.", es: "Si se cobró al cliente pero la aplicación indica impago, no le pidas que vuelva a pagar; contacta a soporte con la referencia, el importe y la hora." },
    action: { href: "/profile", en: "Check payment setup", es: "Revisar configuración de pagos" },
  },
  {
    slug: "sign-in-help", title: { en: "Get back into your account", es: "Recupera el acceso a tu cuenta" },
    summary: { en: "Reset your password or report a blocked sign-in.", es: "Restablece tu contraseña o informa un bloqueo de acceso." },
    steps: { en: ["Open Forgot password and enter the email for your WorkCraft AI account.", "Check your inbox and spam folder; allow a short delay before requesting another message.", "If a workplace security page blocks sign-in, note the blocked hostname and reason.", "Contact support if you still cannot get in."], es: ["Abre Olvidé mi contraseña e ingresa el correo de tu cuenta de WorkCraft AI.", "Revisa la bandeja de entrada y spam; espera un poco antes de pedir otro mensaje.", "Si una página de seguridad laboral bloquea el acceso, anota el dominio y la razón.", "Contacta a soporte si aún no puedes entrar."] },
    note: { en: "Never send your password, reset link, or security code to support.", es: "Nunca envíes tu contraseña, enlace de restablecimiento ni código de seguridad a soporte." },
    action: { href: "/forgot-password", en: "Reset password", es: "Restablecer contraseña" },
  },
];
