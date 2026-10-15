import defaults from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { Callout } from '@/components/callout';
import { ChartPreview } from '@/components/chart-preview';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...defaults, Callout, ChartPreview, ...components };
}
export const useMDXComponents = getMDXComponents;
