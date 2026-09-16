Deliberately not a .sql file — this fixture's migrations/down/ directory
exists but ships zero down-migrations, for the "--drop-data requested but
migrations/down is empty" branch in ModuleRegistryService.runDownMigrationsIfPresent.
