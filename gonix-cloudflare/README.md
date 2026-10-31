# GONIX · Llamadas automáticas de prueba (Cloudflare + Twilio)

Proyecto de **prueba gratuita de 30 días**, compatible con **GONIX 7 Android**.

Este Worker recibe recordatorios desde la aplicación GONIX por HTTPS, los guarda en D1 y, aproximadamente en el minuto de vencimiento, solicita una llamada real mediante la API de Twilio usando el audio **de demostración oficial**. No convierte el texto de un recordatorio en voz personalizada mientras la prueba esté restringida.

## Desplegar sin Android Studio ni servidor propio

[Implementar en Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/NicoGonzalez123/trabajo-git/tree/main/gonix-cloudflare)

1. Accede a Cloudflare y selecciona el plan **Workers Free** si está disponible para tu cuenta. Autoriza GitHub y confirma la creación del Worker `gonix-llamadas-prueba` y su base D1. El asistente de despliegue puede cambiar los nombres o crear una copia del repositorio.
2. Antes de iniciar las llamadas, entra a tu Worker en Cloudflare → **Settings → Variables and Secrets**. Configura los secretos `API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TARGET_PHONE`. Los secretos se introducen directamente en Cloudflare, **nunca** en GitHub, ChatGPT ni documentos públicos. `TARGET_PHONE` es el celular que ya verificaste en Twilio, con formato `+569XXXXXXXX`; `TWILIO_FROM` es el número saliente temporal que muestra *Try out Voice*.
3. Deja `CALLS_ENABLED=false` hasta confirmar todos los datos. Comprueba que se haya creado el disparador Cron `* * * * *`, la base D1 vinculada como `DB` y las tablas mediante `migrations/0001_init.sql`. Si el despliegue no ejecutó la migración, en la consola D1 aplica el SQL de ese archivo (o `npx wrangler d1 migrations apply DB --remote`).
4. Activa `CALLS_ENABLED=true` en **Settings → Variables and Secrets** del Worker y guarda los cambios. No actives este interruptor hasta verificar que tu cuenta sigue en prueba, el número destinatario es tuyo y los datos son correctos.
5. Abre GONIX 7 → **Ajustes** → guarda tu número → **Servidor de llamadas**. Pega la dirección HTTPS del Worker (por ejemplo, `https://gonix-llamadas-prueba.TU-SUBDOMINIO.workers.dev`) y en *Clave del servidor* escribe el mismo valor `API_KEY` guardado en Cloudflare. Presiona **Verificar número y servicio**.
6. Presiona **Solicitar llamada de prueba**. Al contestar escucharás el texto de demostración de Twilio. Programa después un recordatorio de **Llamada telefónica real** para **20 minutos después**, guarda y verifica que se haya sincronizado. Cloudflare lo revisa cada minuto; hay variación, no se garantiza el segundo exacto.

El botón de implementación automática de Cloudflare y la interfaz pueden variar. Si el asistente no ofrece la configuración de secretos o de migraciones, hazlo después de desplegar en Settings/D1.

## Restricciones importantes

- El **móvil destinatario tiene que estar verificado** y estar en el mismo país donde registraste la prueba de Twilio. Esta versión solo acepta un número chileno preautorizado.
- El plan de prueba de Twilio ofrece hasta **75 minutos de voz o 30 días**, lo que termine primero; no es gratuito para siempre. Nunca activa una cuenta de pago ni compra números.
- La versión de prueba usa `voice_text_to_speech` de Twilio; **no lee todavía el título personalizado de tus recordatorios**. Los mensajes personalizados de llamada se pueden abordar cuando el proveedor los admita en tu cuenta.
- El `CALLS_ENABLED=false` inicial evita llamadas por accidente. Hay un límite adicional de **5 solicitudes de llamada por día**, 60 segundos entre pruebas y un historial para evitar llamadas duplicadas por vencimiento.
- El Cron tiene precisión aproximada de **1 minuto**, pero puede haber retrasos; no sirve para alertas de seguridad ni emergencias. Mantén habilitada también la alarma local de GONIX en el teléfono.
- La clave de acceso `API_KEY` y las credenciales Twilio nunca van incluidas en el APK ni en el repositorio. La aplicación guarda su clave de servidor cifrada en Android Keystore.
- El código incluye `/health` sin autenticación, y rutas `/api/status`, `/api/verify-target`, `/api/reminders`, `/api/test-call` protegidas con `X-API-Key` para ser compatibles con GONIX 7.
- Cuando cambies o elimines un recordatorio en Android, utiliza **Sincronizar recordatorios** si la aplicación no muestra que se actualizó el servidor.

## Alternativa técnica sin el botón

Usa la CLI [Wrangler de Cloudflare](https://developers.cloudflare.com/workers/wrangler/): crea una base D1 llamada `gonix-reminders`, copia su ID a `wrangler.toml`, ejecuta `npm install`, aplica `npx wrangler d1 migrations apply DB --remote` y `npx wrangler deploy`. Agrega los secretos mediante el panel o `npx wrangler secret put NOMBRE`, uno por uno. Nunca uses `.env` con credenciales en un repositorio.

## Pruebas sin llamar

Ejecuta `node --test tests/*.test.mjs` para verificar fechas, recurrencias, validación y autenticación. No realiza llamadas reales ni consulta tu cuenta de Twilio.

Sitios oficiales:
- https://www.twilio.com/docs/usage/trials/try-out-voice
- https://developers.cloudflare.com/workers/platform/deploy-buttons/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
