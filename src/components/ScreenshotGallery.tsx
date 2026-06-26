import { useState } from 'react'

interface Screenshot {
  timestamp: string
  imagePath: string
  aiPrediction?: string
  activityLabel?: string
  recommendation?: string
}

interface ScreenshotGalleryProps {
  screenshots: Screenshot[]
  maxDisplay?: number
}

export function ScreenshotGallery({ screenshots, maxDisplay = 10 }: ScreenshotGalleryProps) {
  const [selectedImage, setSelectedImage] = useState<Screenshot | null>(null)
  const [showAll, setShowAll] = useState(false)

  if (!screenshots || screenshots.length === 0) {
    return (
      <div className="bg-gray-700 rounded-lg p-4 text-center text-gray-400">
        No screenshots captured yet
      </div>
    )
  }

  // Sort by timestamp descending (most recent first)
  const sortedScreenshots = [...screenshots].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  const displayedScreenshots = showAll 
    ? sortedScreenshots 
    : sortedScreenshots.slice(0, maxDisplay)

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Screenshot History</h3>
        {screenshots.length > maxDisplay && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-sm text-primary-400 hover:text-primary-300 transition-colors"
          >
            {showAll ? 'Show Less' : `View All (${screenshots.length})`}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {displayedScreenshots.map((screenshot, index) => (
          <button
            key={`${screenshot.timestamp}-${index}`}
            onClick={() => setSelectedImage(screenshot)}
            className="group relative aspect-video bg-gray-700 rounded-lg overflow-hidden hover:ring-2 hover:ring-primary-500 transition-all"
          >
            <img
              src={`file://${screenshot.imagePath}`}
              alt={`Screenshot from ${formatTimestamp(screenshot.timestamp)}`}
              className="w-full h-full object-cover"
              onError={(e) => {
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                const parent = target.parentElement
                if (parent) {
                  parent.innerHTML = '<div class="flex items-center justify-center h-full text-gray-500 text-xs">Image not found</div>'
                }
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="absolute bottom-0 left-0 right-0 p-2">
                <p className="text-white text-xs font-medium truncate">
                  {formatTimestamp(screenshot.timestamp)}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Modal for full-size view */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="bg-gray-800 rounded-lg max-w-5xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between">
              <div>
                <h4 className="font-semibold text-lg">
                  {formatTimestamp(selectedImage.timestamp)}
                </h4>
                {selectedImage.activityLabel && (
                  <p className="text-sm text-gray-400 mt-1">
                    Activity: {selectedImage.activityLabel}
                  </p>
                )}
              </div>
              <button
                onClick={() => setSelectedImage(null)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-4">
              <img
                src={`file://${selectedImage.imagePath}`}
                alt={`Screenshot from ${formatTimestamp(selectedImage.timestamp)}`}
                className="w-full rounded-lg"
              />
              
              {(selectedImage.aiPrediction || selectedImage.recommendation) && (
                <div className="mt-4 space-y-2">
                  {selectedImage.aiPrediction && (
                    <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-3">
                      <p className="text-sm font-semibold text-blue-300 mb-1">AI Analysis</p>
                      <p className="text-blue-200 text-sm">{selectedImage.aiPrediction}</p>
                    </div>
                  )}
                  
                  {selectedImage.recommendation && (
                    <div className="bg-purple-900/30 border border-purple-700 rounded-lg p-3">
                      <p className="text-sm font-semibold text-purple-300 mb-1">Recommendation</p>
                      <p className="text-purple-200 text-sm">{selectedImage.recommendation}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Made with Bob
