export async function register() {
  // Vercel Functions are request-driven, so scheduled work belongs to the
  // protected Vercel Cron route. Preserve the timer only for self-hosted Node.
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.VERCEL !== '1') {
    const { startCatalogMaintenance } = await import('./lib/catalog-maintenance');
    startCatalogMaintenance();
  }
}
