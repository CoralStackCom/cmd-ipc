/**
 * Mermaid Diagram Expandable Modal
 * Click on any mermaid diagram to open it in a full-screen modal
 */
;(function () {
  'use strict'

  // Create modal overlay element
  function createModal() {
    const overlay = document.createElement('div')
    overlay.className = 'mermaid-modal-overlay'
    overlay.innerHTML = `
      <div class="mermaid-modal-content">
        <button class="mermaid-modal-close" aria-label="Close">&times;</button>
        <div class="mermaid-modal-body"></div>
        <div class="mermaid-modal-hint">Press Escape or click outside to close</div>
      </div>
    `
    document.body.appendChild(overlay)
    return overlay
  }

  // Initialize modal functionality
  function init() {
    const modal = createModal()
    const modalBody = modal.querySelector('.mermaid-modal-body')
    const closeBtn = modal.querySelector('.mermaid-modal-close')

    // Close modal function
    function closeModal() {
      modal.classList.remove('active')
      document.body.style.overflow = ''
    }

    // Open modal with diagram content
    function openModal(diagramEl) {
      const svg = diagramEl.querySelector('svg')
      if (svg) {
        modalBody.innerHTML = ''
        const clonedSvg = svg.cloneNode(true)
        // Remove any width/height constraints for better scaling
        clonedSvg.style.maxWidth = '100%'
        clonedSvg.style.height = 'auto'
        modalBody.appendChild(clonedSvg)
        modal.classList.add('active')
        document.body.style.overflow = 'hidden'
      }
    }

    // Event listeners for closing
    closeBtn.addEventListener('click', closeModal)

    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        closeModal()
      }
    })

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('active')) {
        closeModal()
      }
    })

    // Wrap mermaid diagrams and add click handlers
    function setupDiagrams() {
      const diagrams = document.querySelectorAll('.mermaid:not(.mermaid-wrapped)')

      diagrams.forEach(function (diagram) {
        // Mark as processed
        diagram.classList.add('mermaid-wrapped')

        // Create wrapper
        const wrapper = document.createElement('div')
        wrapper.className = 'mermaid-wrapper'

        // Wrap the diagram
        diagram.parentNode.insertBefore(wrapper, diagram)
        wrapper.appendChild(diagram)

        // Add click handler
        wrapper.addEventListener('click', function () {
          openModal(diagram)
        })
      })
    }

    // Initial setup
    setupDiagrams()

    // Re-run on page navigation (for Astro view transitions)
    document.addEventListener('astro:page-load', setupDiagrams)

    // Also watch for dynamically added mermaid diagrams
    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.addedNodes.length) {
          setupDiagrams()
        }
      })
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    })
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
