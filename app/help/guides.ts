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
    steps: { en: ["Describe the job and measurements in the Pro AI assistant.", "Compare any Price Book matches with your saved rates.", "Check every suggested unit, quantity, labor and material assumption.", "Edit the rates and confirm the final total before sharing."], es: ["Describe el trabajo y las medidas en el asistente de IA Pro.", "Compara las coincidencias con tus precios guardados.", "Revisa cada unidad, cantidad y supuesto de mano de obra y materiales.", "Edita los precios y confirma el total antes de compartir."] },
    note: { en: "AI suggestions are starting estimates, not live local supplier quotes. Uncertain Price Book matches need your selection.", es: "Las sugerencias de IA son puntos de partida, no precios actuales de proveedores locales. Debes elegir las coincidencias inciertas de la lista de precios." },
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
