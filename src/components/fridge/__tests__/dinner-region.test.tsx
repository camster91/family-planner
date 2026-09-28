/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { DinnerRegion, dinnerRecipeLine } from '../regions'

describe('fridge dinner: linked recipe title and prep time (ADR-0007, #252)', () => {
  it('adds the recipe title only when it differs from the meal name, and the prep time', () => {
    expect(dinnerRecipeLine({ recipeName: 'Veggie lasagna', recipeTitle: 'Veggie lasagna', prepMinutes: 25 })).toBe('Prep 25 min')
    expect(dinnerRecipeLine({ recipeName: 'Taco night', recipeTitle: 'Veggie tacos', prepMinutes: null })).toBe('Recipe: Veggie tacos')
    expect(dinnerRecipeLine({ recipeName: 'Taco night', recipeTitle: 'Veggie tacos', prepMinutes: 90 })).toBe('Recipe: Veggie tacos · Prep 1 h 30 min')
  })

  it('shows nothing extra for a free-text dinner (DTO without recipe fields)', () => {
    expect(dinnerRecipeLine({ recipeName: 'Leftovers' })).toBeNull()
    render(
      <DinnerRegion
        dinner={{ id: 'd', day: '2026-01-05', recipeName: 'Leftovers', cookName: 'Pat' }}
        mealsEnabled
        mealsHref={null}
        featuresHref={null}
      />
    )
    expect(screen.getByTestId('dinner-tonight').textContent).toBe('LeftoversCooking: Pat')
  })

  it('renders the recipe line on the board', () => {
    render(
      <DinnerRegion
        dinner={{ id: 'd', day: '2026-01-05', recipeName: null, cookName: null, recipeTitle: 'Tofu stir-fry', prepMinutes: 15 }}
        mealsEnabled
        mealsHref={null}
        featuresHref={null}
      />
    )
    // No snapshot name: the recipe title is the headline, so it is not repeated.
    expect(screen.getByTestId('dinner-tonight').textContent).toBe('Tofu stir-fryPrep 15 min')
  })
})
