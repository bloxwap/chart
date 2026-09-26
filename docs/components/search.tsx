'use client';

import { useDocsSearch } from 'fumadocs-core/search/client';
import { staticClient } from 'fumadocs-core/search/client/orama-static';
import {
  SearchDialog, SearchDialogClose, SearchDialogContent, SearchDialogHeader,
  SearchDialogIcon, SearchDialogInput, SearchDialogList, SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import { assetUrl } from '@/lib/site';

export default function StaticSearch(props: SharedProps) {
  const { search, setSearch, query } = useDocsSearch({
    client: staticClient({ from: assetUrl('/search.json') }),
  });
  return (
    <SearchDialog search={search} onSearchChange={setSearch} isLoading={query.isLoading} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader><SearchDialogIcon /><SearchDialogInput /><SearchDialogClose /></SearchDialogHeader>
        <SearchDialogList items={query.data === 'empty' ? null : query.data} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
