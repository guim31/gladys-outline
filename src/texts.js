// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. Outline menus are named as in its English interface
// ("Settings → API & Apps"). German says "du", Spanish "usted"
// (test/i18n.test.js).
// -----------------------------------------------------------------------------

// Feature names (frozen by Gladys at creation).
export const NAMES = {
  en: {
    reachable: 'Reachable',
    documents: 'Documents',
    collections: 'Collections',
    latest: 'Latest changed document',
    latest_by: 'Latest change by',
    latest_at: 'Latest change at',
  },
  fr: {
    reachable: 'Joignable',
    documents: 'Documents',
    collections: 'Collections',
    latest: 'Dernier document modifié',
    latest_by: 'Dernière modification par',
    latest_at: 'Dernière modification le',
  },
  de: {
    reachable: 'Erreichbar',
    documents: 'Dokumente',
    collections: 'Sammlungen',
    latest: 'Zuletzt geändertes Dokument',
    latest_by: 'Letzte Änderung von',
    latest_at: 'Letzte Änderung am',
  },
  es: {
    reachable: 'Accesible',
    documents: 'Documentos',
    collections: 'Colecciones',
    latest: 'Último documento modificado',
    latest_by: 'Última modificación por',
    latest_at: 'Última modificación el',
  },
};

/** The text of the "latest" features of an empty wiki. */
export const NONE = { en: 'None', fr: 'Aucun', de: 'Keins', es: 'Ninguno' };

export const STATUS_TEXT = {
  en: {
    none: 'Enter the address of Outline and an API key in the configuration.',
    invalid: 'The Outline address is not valid: enter an address like 192.168.1.50:3000.',
    key: 'Enter an API key (Outline → Settings → API & Apps).',
    unauthorized: 'Outline did not accept the API key: check it, and that it has not expired.',
    forbidden: 'The API key may not read the documents: give it the read scopes, or none.',
    unreachable: 'Outline does not answer: check its address and that it is running.',
    redirected:
      'Outline answers at another address: enter the address of your browser, starting with https://.',
    rate_limited: 'Outline limits the requests of this key: the integration will try again later.',
    error: 'Outline answered with an error: see the logs of the integration.',
    invalid_answer: 'This address does not answer like Outline: check the address and the port.',
  },
  fr: {
    none: "Saisissez l'adresse d'Outline et une clé d'API dans la configuration.",
    invalid:
      "L'adresse d'Outline n'est pas valide : saisissez une adresse comme 192.168.1.50:3000.",
    key: "Saisissez une clé d'API (Outline → Settings → API & Apps).",
    unauthorized: "Outline n'a pas accepté la clé d'API : vérifiez-la, et qu'elle n'a pas expiré.",
    forbidden:
      "La clé d'API ne peut pas lire les documents : donnez-lui les droits de lecture, ou aucune restriction.",
    unreachable: "Outline ne répond pas : vérifiez son adresse et qu'il est démarré.",
    redirected:
      'Outline répond à une autre adresse : saisissez celle de votre navigateur, commençant par https://.',
    rate_limited: "Outline limite les requêtes de cette clé : l'intégration réessaiera plus tard.",
    error: "Outline a répondu par une erreur : consultez les journaux de l'intégration.",
    invalid_answer: "Cette adresse ne répond pas comme Outline : vérifiez l'adresse et le port.",
  },
  de: {
    none: 'Gib in der Konfiguration die Adresse von Outline und einen API-Schlüssel ein.',
    invalid: 'Die Outline-Adresse ist ungültig: Gib eine Adresse wie 192.168.1.50:3000 ein.',
    key: 'Gib einen API-Schlüssel ein (Outline → Settings → API & Apps).',
    unauthorized:
      'Outline hat den API-Schlüssel nicht akzeptiert: Prüfe ihn und ob er abgelaufen ist.',
    forbidden:
      'Der API-Schlüssel darf die Dokumente nicht lesen: Gib ihm Leserechte oder keine Einschränkung.',
    unreachable: 'Outline antwortet nicht: Prüfe die Adresse und ob es läuft.',
    redirected:
      'Outline antwortet unter einer anderen Adresse: Gib die deines Browsers ein, beginnend mit https://.',
    rate_limited:
      'Outline begrenzt die Anfragen dieses Schlüssels: Die Integration versucht es später erneut.',
    error: 'Outline hat mit einem Fehler geantwortet: Sieh dir die Logs der Integration an.',
    invalid_answer: 'Diese Adresse antwortet nicht wie Outline: Prüfe Adresse und Port.',
  },
  es: {
    none: 'Introduzca la dirección de Outline y una clave de API en la configuración.',
    invalid:
      'La dirección de Outline no es válida: introduzca una dirección como 192.168.1.50:3000.',
    key: 'Introduzca una clave de API (Outline → Settings → API & Apps).',
    unauthorized: 'Outline no aceptó la clave de API: compruébela, y que no haya caducado.',
    forbidden:
      'La clave de API no puede leer los documentos: dele permisos de lectura, o ninguna restricción.',
    unreachable: 'Outline no responde: compruebe su dirección y que esté en marcha.',
    redirected:
      'Outline responde en otra dirección: introduzca la de su navegador, que empieza por https://.',
    rate_limited:
      'Outline limita las solicitudes de esta clave: la integración lo intentará más tarde.',
    error: 'Outline respondió con un error: consulte los registros de la integración.',
    invalid_answer: 'Esta dirección no responde como Outline: compruebe la dirección y el puerto.',
  },
};

/** "Test the connection" once Outline answered. */
export const TEST_TEXT = {
  en: (documents, collections) =>
    `Connected to Outline: ${documents} document(s) in ${collections} collection(s).`,
  fr: (documents, collections) =>
    `Connecté à Outline : ${documents} document(s) dans ${collections} collection(s).`,
  de: (documents, collections) =>
    `Mit Outline verbunden: ${documents} Dokument(e) in ${collections} Sammlung(en).`,
  es: (documents, collections) =>
    `Conectado a Outline: ${documents} documento(s) en ${collections} colección(es).`,
};

export const INIT_FAILED = {
  en: 'The integration could not start: see its logs.',
  fr: "L'intégration n'a pas pu démarrer : consultez ses journaux.",
  de: 'Die Integration konnte nicht starten: Sieh dir ihre Logs an.',
  es: 'La integración no pudo iniciarse: consulte sus registros.',
};

// Errors of the scene actions. `{name}` is what the user typed (a
// collection, a document), `{detail}` the reason Outline gave.
export const COMMAND_ERRORS = {
  en: {
    timeout: 'Outline answered too late: the document may have been written anyway.',
    http: 'Outline could not do it: {detail}',
    unreachable: 'Outline does not answer: nothing was done.',
    unauthorized: 'Outline did not accept the API key: nothing was done.',
    forbidden: 'The API key may not do this: nothing was done.',
    redirected:
      'Outline answers at another address: enter the address of your browser, starting with https://.',
    rate_limited: 'Outline limits the requests of this key: try again in a minute.',
    collection: 'No collection named "{name}": nothing was done.',
    collection_missing: 'Enter the collection of the document.',
    document: 'No document "{name}": enter its title, its address or a collection to create it.',
    document_missing: 'Enter the document: its title or its address.',
    title: 'Enter the title of the document.',
    line: 'Enter the line to add.',
    query: 'Enter the words to search for.',
    no_result: 'No document matches "{name}".',
    rejected: 'Outline refused it: {detail}',
  },
  fr: {
    timeout: 'Outline a répondu trop tard : le document a peut-être été écrit quand même.',
    http: "Outline n'a pas pu le faire : {detail}",
    unreachable: "Outline ne répond pas : rien n'a été fait.",
    unauthorized: "Outline n'a pas accepté la clé d'API : rien n'a été fait.",
    forbidden: "La clé d'API ne permet pas de le faire : rien n'a été fait.",
    redirected:
      'Outline répond à une autre adresse : saisissez celle de votre navigateur, commençant par https://.',
    rate_limited: 'Outline limite les requêtes de cette clé : réessayez dans une minute.',
    collection: "Aucune collection nommée « {name} » : rien n'a été fait.",
    collection_missing: 'Saisissez la collection du document.',
    document:
      'Aucun document « {name} » : saisissez son titre, son adresse ou une collection pour le créer.',
    document_missing: 'Saisissez le document : son titre ou son adresse.',
    title: 'Saisissez le titre du document.',
    line: 'Saisissez la ligne à ajouter.',
    query: 'Saisissez les mots à rechercher.',
    no_result: 'Aucun document ne correspond à « {name} ».',
    rejected: 'Outline a refusé : {detail}',
  },
  de: {
    timeout: 'Outline hat zu spät geantwortet: Das Dokument wurde vielleicht trotzdem geschrieben.',
    http: 'Outline konnte es nicht ausführen: {detail}',
    unreachable: 'Outline antwortet nicht: Es wurde nichts getan.',
    unauthorized: 'Outline hat den API-Schlüssel nicht akzeptiert: Es wurde nichts getan.',
    forbidden: 'Der API-Schlüssel erlaubt das nicht: Es wurde nichts getan.',
    redirected:
      'Outline antwortet unter einer anderen Adresse: Gib die deines Browsers ein, beginnend mit https://.',
    rate_limited:
      'Outline begrenzt die Anfragen dieses Schlüssels: Versuche es in einer Minute erneut.',
    collection: 'Keine Sammlung namens „{name}“: Es wurde nichts getan.',
    collection_missing: 'Gib die Sammlung des Dokuments ein.',
    document:
      'Kein Dokument „{name}“: Gib seinen Titel, seine Adresse oder eine Sammlung zum Erstellen ein.',
    document_missing: 'Gib das Dokument ein: seinen Titel oder seine Adresse.',
    title: 'Gib den Titel des Dokuments ein.',
    line: 'Gib die hinzuzufügende Zeile ein.',
    query: 'Gib die Suchbegriffe ein.',
    no_result: 'Kein Dokument passt zu „{name}“.',
    rejected: 'Outline hat abgelehnt: {detail}',
  },
  es: {
    timeout:
      'Outline respondió demasiado tarde: puede que el documento se haya escrito de todos modos.',
    http: 'Outline no pudo hacerlo: {detail}',
    unreachable: 'Outline no responde: no se ha hecho nada.',
    unauthorized: 'Outline no aceptó la clave de API: no se ha hecho nada.',
    forbidden: 'La clave de API no permite hacerlo: no se ha hecho nada.',
    redirected:
      'Outline responde en otra dirección: introduzca la de su navegador, que empieza por https://.',
    rate_limited: 'Outline limita las solicitudes de esta clave: inténtelo de nuevo en un minuto.',
    collection: 'No hay ninguna colección llamada «{name}»: no se ha hecho nada.',
    collection_missing: 'Introduzca la colección del documento.',
    document:
      'No hay ningún documento «{name}»: introduzca su título, su dirección o una colección para crearlo.',
    document_missing: 'Introduzca el documento: su título o su dirección.',
    title: 'Introduzca el título del documento.',
    line: 'Introduzca la línea que desea añadir.',
    query: 'Introduzca las palabras que desea buscar.',
    no_result: 'Ningún documento coincide con «{name}».',
    rejected: 'Outline lo rechazó: {detail}',
  },
};

/** A coded message in every language, details filled in. */
export function commandMessage(code, values = {}) {
  return Object.fromEntries(
    Object.entries(COMMAND_ERRORS).map(([language, table]) => [
      language,
      (table[code] ?? table.unreachable)
        .replace('{name}', () => values.name ?? '')
        .replace('{detail}', () => values.detail ?? '')
        .slice(0, 200),
    ]),
  );
}

export const pick = (table, language) => table[language] ?? table.en;
