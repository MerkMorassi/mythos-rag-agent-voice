// js/ingestion/exporter.js
export function buildLorePack({ agent, roleLayer, memory }) {
  const now = new Date().toISOString();
  const date = now.slice(0, 10);

  const filename = roleLayer && roleLayer !== 'ROOT'
    ? `${agent}.${roleLayer}.LOREPACK.${date}.json`
    : `${agent}.LOREPACK.${date}.json`;

  return {
    filename,
    json: {
      schema: 'MYTHOS.LOREPACK.v1',
      locus: `MYTHOS.LORE.${agent}${roleLayer ? '.' + roleLayer : ''}`,
      createdAt: now,
      agent: {
        handle: agent.toLowerCase(),
        displayName: agent,
        roleLayer: roleLayer || 'ROOT'
      },
      memory
    }
  };
}
