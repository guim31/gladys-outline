// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`): create a document — a report, a
// note dictated to a voice scene — add a line at the end of a "journal"
// document (created at its first line when a collection is given), and
// search the wiki (the best match goes to the next actions of the scene).
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async create_document(hub, { fields = {} }) {
    return hub.createDocument({
      collection: fields.collection,
      title: fields.title,
      text: fields.text,
    });
  },
  async append_line(hub, { fields = {} }) {
    return hub.appendToDocument({
      document: fields.document,
      line: fields.line,
      addTime: fields.add_time,
      collection: fields.collection,
    });
  },
  async search_documents(hub, { fields = {} }) {
    return hub.search({ query: fields.query, collection: fields.collection });
  },
};
