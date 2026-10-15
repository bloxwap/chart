'use client';

import { useDocsSearch } from 'fumadocs-core/search/client';
import { staticClient } from 'fumadocs-core/search/client/orama-static';
import {
  SearchDialog, SearchDialogClose, SearchDialogContent, SearchDialogHeader,
  SearchDialogIcon, SearchDialogInput, SearchDialogList, SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import { Alert, EmptyState } from '@bloxwap/hig-react/status';
import { assetUrl } from '@/lib/site';

function NoResults() {
  return <div role="status" className="search-empty"><EmptyState title="No results" description="Try a shorter or different term, or browse the documentation navigation." /></div>;
}

export default function StaticSearch(props: SharedProps) {
  const { search, setSearch, query } = useDocsSearch({
    client: staticClient({ from: assetUrl('/search.json') }),
  });
  return (
    <SearchDialog search={search} onSearchChange={setSearch} isLoading={query.isLoading} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader><SearchDialogIcon /><SearchDialogInput /><SearchDialogClose /></SearchDialogHeader>
        {query.error && <div className="search-error"><Alert title="Search is unavailable" severity="error"><p>Use the documentation navigation, or close search and try again.</p></Alert></div>}
        <SearchDialogList items={query.data === 'empty' ? null : query.data} Empty={NoResults} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
