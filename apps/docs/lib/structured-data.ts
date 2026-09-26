import { basePath, repository, siteUrl } from './site';

/** Company facts shared by the docs and the bloxwap.github.io root site. Keep them true. */
export const organization = {
  name: 'Bloxwap, Inc.',
  url: 'https://bloxwap.com',
  email: 'support@bloxwap.com',
  sameAs: ['https://x.com/bloxwap', 'https://github.com/bloxwap', 'https://discord.com/invite/cEfkcg6JHT', 'https://bloxwap.com', 'https://bloxwap.pro'],
  about: `${siteUrl}/about/`,
  contact: `${siteUrl}/contact/`,
  privacy: `${siteUrl}/privacy/`,
};

/** Homepage JSON-LD: the library as a SoftwareApplication, published by the organization. */
export function homeStructuredData(): Record<string, unknown> {
  const home = `${siteUrl}${basePath}/`;
  const org = {
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: organization.name,
    url: organization.url,
    logo: `${home}icon.svg`,
    email: organization.email,
    sameAs: organization.sameAs,
    contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: organization.email, url: organization.contact },
  };
  return {
    '@context': 'https://schema.org',
    '@graph': [
      org,
      {
        '@type': 'SoftwareApplication',
        '@id': `${home}#software`,
        name: '@bloxwap/chart',
        alternateName: 'Bloxwap Chart SDK',
        description: 'A zero-dependency TypeScript library for interactive financial charts on HTML canvas, with WebAssembly-accelerated math, built-in indicators, and 89 drawing tools.',
        url: home,
        applicationCategory: 'DeveloperApplication',
        applicationSubCategory: 'Charting library',
        operatingSystem: 'Web browser, Node.js',
        programmingLanguage: 'TypeScript',
        softwareVersion: '0.1.0',
        license: 'https://opensource.org/licenses/MIT',
        codeRepository: repository,
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        publisher: { '@id': org['@id'] },
      },
      {
        '@type': 'WebSite',
        '@id': `${home}#website`,
        name: 'Bloxwap Chart SDK documentation',
        url: home,
        inLanguage: 'en',
        publisher: { '@id': org['@id'] },
      },
    ],
  };
}
