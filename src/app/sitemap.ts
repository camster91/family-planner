import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://family.ashbi.ca',
      lastModified: new Date(),
      priority: 1.0,
      changeFrequency: 'daily',
    },
    {
      url: 'https://family.ashbi.ca/login',
      lastModified: new Date(),
      priority: 0.8,
      changeFrequency: 'monthly',
    },
    {
      url: 'https://family.ashbi.ca/register',
      lastModified: new Date(),
      priority: 0.9,
      changeFrequency: 'monthly',
    },
  ]
}
