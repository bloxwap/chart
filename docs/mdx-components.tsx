import defaults from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { ChartPreview } from '@/components/chart-preview';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...defaults, ChartPreview, ...components };
}
export const useMDXComponents = getMDXComponents;
