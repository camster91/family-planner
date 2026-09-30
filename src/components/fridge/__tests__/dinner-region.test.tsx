/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { DinnerRegion, dinnerRecipeLine, missingIngredientsLine } from '../regions'

describe('fridge dinner: missing ingredients (#122)', () => {
  it('uses plain wording and says nothing when none are missing or the count is unknown', () => {
    expect(missingIngredientsLine(2)).toBe('2 ingredients missing')
    expect(missingIngredientsLine(1)).toBe('1 ingredient missing')
    expect(missingIngredientsLine(0)).toBeNull()
    expect(missingIngredientsLine(undefined)).toBeNull()
    expect(missingIngredientsLine(null)).toBeNull()
  })

  it('renders the line under the recipe line', () => {
    render(
      <DinnerRegion
        dinner={{ id: 'd', day: '2026-01-05', recipeName: null, cookName: null, recipeTitle: 'Tofu stir-fry', prepMinutes: 15, missingIngredients: 2 }}
        mealsEnabled
        mealsHref={null}
        featuresHref={null}
      />
    )
    expect(screen.getByTestId('dinner-missing').textContent).toBe('2 ingredients missing')
    expect(screen.getByTestId('dinner-tonight').textContent).toBe('Tofu stir-fryPrep 15 min2 ingredients missing')
  })

  it('shows nothing when nothing is missing (and a device DTO never has the field)', () => {
    render(
      <DinnerRegion
        dinner={{ id: 'd', day: '2026-01-05', recipeName: 'Soup', cookName: null, recipeTitle: 'Soup', prepMinutes: null, missingIngredients: 0 }}
        mealsEnabled
        mealsHref={null}
        featuresHref={null}
      />
    )
    expect(screen.queryByTestId('dinner-missing')).toBeNull()
    expect(screen.getByTestId('dinner-tonight').textContent).toBe('Soup')
  })
})

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
