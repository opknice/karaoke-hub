export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCatalogMaintenance } = await import('./lib/catalog-maintenance');
    startCatalogMaintenance();
  }
}
