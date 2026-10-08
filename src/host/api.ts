/** The slice of the Logseq plugin API this plugin uses; lets tests pass a fake. */
export interface LogseqLike {
  DB: { datascriptQuery(query: string, ...inputs: unknown[]): Promise<any> };
  Editor: {
    getBlock(id: string | number, opts?: { includeChildren?: boolean }): Promise<any>;
    getPage(id: string | number): Promise<any>;
    getPageBlocksTree(name: string): Promise<any[] | null>;
    updateBlock(uuid: string, content: string): Promise<unknown>;
    scrollToBlockInPage(page: string, uuid: string): void;
    upsertBlockProperty(uuid: string, key: string, value: unknown): Promise<unknown>;
    removeBlockProperty(uuid: string, key: string): Promise<unknown>;
  };
}
